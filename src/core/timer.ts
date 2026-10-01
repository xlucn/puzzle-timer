/*
 * timer.ts — the timing state machine.
 *
 * Architecture rule (see AGENTS.md): pure TypeScript, no `gi:*`, no Node APIs.
 * All time is passed in by the caller as milliseconds from a monotonic clock,
 * which makes every transition deterministic and testable.
 *
 *   idle ──keydown(startKey)──▶ holding ──hold ≥ threshold──▶ ready
 *     ▲                          │                              │
 *     └──release too early───────┘                              │
 *                                                                │
 *   ready ──release(startKey)──▶ running ──any keydown──▶ stopped
 *                                                                 │
 *   stopped ──keydown(startKey)──▶ holding (next solve) ──────────┘
 *
 * With WCA inspection on (the default), the first ready→release does not
 * start a solve but enters `inspecting`; the hold/release dance then happens
 * again *inside* the inspection, and the second release starts the run —
 * carrying a penalty derived from the inspection's age at that instant:
 *
 *   inspecting ──keydown(startKey)──▶ holding ──▶ ready ──release──▶ running
 *       ▲                              │early       │
 *       └──────────────────────────────┘release     └ (age ≥ 15 s → +2,
 *       └── Esc ──▶ idle                              ≥ 17 s → DNF)
 *
 * GTK does not report keyboard auto-repeat (a held key produces repeated
 * *press* events and a single *release*), so keyDown() ignores any key it has
 * already seen and not yet seen released. That dedup lives here rather than in
 * the UI layer precisely so it can be tested.
 */

import { type Penalty } from './time.js'
import { MAX_HOLD_THRESHOLD_MS, MIN_HOLD_THRESHOLD_MS } from './preferences.js'

export type TimerState = 'idle' | 'holding' | 'ready' | 'inspecting' | 'running' | 'stopped'

/** WCA inspection limits (ms of inspection elapsed). */
export const INSPECTION_MS = 15_000
export const INSPECTION_DNF_MS = 17_000
/** Acoustic signals: one sound at 8 s, two at 12 s (WCA-style). */
export const INSPECTION_CUE_8S = 8_000
export const INSPECTION_CUE_12S = 12_000

export interface TimerConfig {
  /** How long the start key must be held before the timer turns "ready". */
  holdThresholdMs: number
  /** Identity of the key that starts the timer (the UI sends 'space'). */
  startKey: string
  /** Initial state of the WCA inspection toggle — on in the app, off in most tests. */
  inspection: boolean
}

export const DEFAULT_TIMER_CONFIG: TimerConfig = {
  holdThresholdMs: 300,
  startKey: 'space',
  inspection: true,
}

export interface TimerSnapshot {
  /** Current state. */
  state: TimerState
  /** Time currently displayed, in milliseconds. */
  elapsedMs: number
  /** 0..1 progress through the hold threshold while holding, 1 when ready. */
  holdProgress: number
  /** Elapsed ms of the active inspection; 0 when no inspection is running. */
  inspectionMs: number
  /**
   * Penalty the current run carries: computed when a run starts out of an
   * inspection, kept while stopped (the readout and onSolved use it), and
   * cleared when the next hold begins.
   */
  penalty: Penalty | undefined
}

/** The WCA inspection acoustic signals the UI must play. */
export type InspectionCue = '8s' | '12s'

export type Unsubscribe = () => void
type SnapshotListener = (snapshot: TimerSnapshot) => void
type SolvedListener = (elapsedMs: number, penalty: Penalty | undefined) => void
type CueListener = (cue: InspectionCue) => void

export class Timer {
  private readonly config: TimerConfig
  private current: TimerState = 'idle'
  private readonly pressed = new Set<string>()
  private holdStartedAt = 0
  private startedAt = 0
  private resultMs: number | null = null

  // WCA inspection. `inspectionOn` is the toggle (memory-only until M5's
  // preferences; starts per config, ON in the app); `inspectionStartedAt > 0`
  // marks the inspection that belongs to the solve being armed/timed.
  private inspectionOn: boolean
  private inspectionStartedAt = 0
  private holdFromInspection = false
  private cue8Fired = false
  private cue12Fired = false
  private pendingPenalty: Penalty | undefined = undefined

  private readonly snapshotListeners = new Set<SnapshotListener>()
  private readonly solvedListeners = new Set<SolvedListener>()
  private readonly cueListeners = new Set<CueListener>()

  constructor(config: Partial<TimerConfig> = {}) {
    this.config = { ...DEFAULT_TIMER_CONFIG, ...config }
    this.inspectionOn = this.config.inspection
  }

  get state(): TimerState {
    return this.current
  }

  /** The most recently completed solve, or null if there is none yet. */
  get lastResultMs(): number | null {
    return this.resultMs
  }

  get startKey(): string {
    return this.config.startKey
  }

  /** Whether WCA inspection is on (starts on). */
  get inspectionEnabled(): boolean {
    return this.inspectionOn
  }

  /** Subscribe to every state/snapshot change. Returns an unsubscribe fn. */
  subscribe(listener: SnapshotListener): Unsubscribe {
    this.snapshotListeners.add(listener)
    return () => this.snapshotListeners.delete(listener)
  }

  /** Called once per completed solve, with elapsed ms and any penalty. */
  onSolved(listener: SolvedListener): Unsubscribe {
    this.solvedListeners.add(listener)
    return () => this.solvedListeners.delete(listener)
  }

  /** Subscribe to the inspection acoustic cues (8 s / 12 s crossings). */
  onCue(listener: CueListener): Unsubscribe {
    this.cueListeners.add(listener)
    return () => this.cueListeners.delete(listener)
  }

  /**
   * Live-update the hold threshold (preferences, M5): the value the dialog
   * writes lands here directly, so the next hold uses it. Clamped to the
   * same range the preferences normaliser enforces — a bad number must not
   * be able to make the timer unarmable (a threshold above 0 with no upper
   * bound would).
   */
  setHoldThreshold(ms: number): void {
    const clamped = Number.isFinite(ms)
      ? Math.min(MAX_HOLD_THRESHOLD_MS, Math.max(MIN_HOLD_THRESHOLD_MS, ms))
      : DEFAULT_TIMER_CONFIG.holdThresholdMs
    this.config.holdThresholdMs = clamped
  }

  /**
   * Toggle WCA inspection. Turning it off mid-inspection cancels the
   * countdown (an inspection whose toggle has gone must not keep scoring);
   * during the pre-run hold it just means the release will start the run
   * without a penalty. `now` is needed because the cancel re-emits.
   */
  setInspection(enabled: boolean, now: number): void {
    if (this.inspectionOn === enabled) return
    this.inspectionOn = enabled

    if (!enabled && this.inspectionStartedAt > 0) {
      this.inspectionStartedAt = 0
      this.cue8Fired = false
      this.cue12Fired = false
      if (this.current === 'inspecting') {
        this.transition('idle', now)
        return
      }
      // holding/ready out of an inspection: the hold simply becomes a
      // normal arming — state stays, release starts the run directly.
    }
    this.emit(now)
  }

  /**
   * The state as of `now`. `now` is milliseconds on a monotonic clock
   * (GLib.getMonotonicTime() / 1000 in the UI layer).
   */
  snapshot(now: number): TimerSnapshot {
    return {
      state: this.current,
      elapsedMs: this.displayMs(now),
      holdProgress: this.progress(now),
      inspectionMs:
        this.inspectionStartedAt > 0 ? Math.max(0, now - this.inspectionStartedAt) : 0,
      penalty: this.pendingPenalty,
    }
  }

  keyDown(key: string, now: number): void {
    // Auto-repeat: a key that is still held produces more press events.
    if (this.pressed.has(key)) return
    this.pressed.add(key)

    switch (this.current) {
      case 'idle':
      case 'stopped':
        if (key === this.config.startKey) this.beginHold(now)
        break
      case 'inspecting':
        if (key === this.config.startKey) this.beginHold(now)
        else if (key === 'escape') this.cancelInspection(now)
        break
      case 'running':
        // Any fresh key press stops the solve.
        this.stop(now)
        break
      case 'holding':
      case 'ready':
        // Extra keys pressed while arming the timer are ignored.
        break
    }
  }

  keyUp(key: string, now: number): void {
    if (!this.pressed.delete(key)) return
    if (key !== this.config.startKey) return

    if (this.current === 'ready') {
      this.release(now)
    } else if (this.current === 'holding') {
      // Released before the threshold: cancel rather than start. The cancel
      // returns where the hold came from — mid-inspection the countdown is
      // still running, a normal hold goes back to idle.
      if (now - this.holdStartedAt >= this.config.holdThresholdMs) this.release(now)
      else this.transition(this.holdFromInspection ? 'inspecting' : 'idle', now)
    }
  }

  /**
   * Drive time-based transitions (hold threshold, inspection cues) and
   * refresh the displayed value. Call it on a tick while holding,
   * inspecting or running.
   */
  update(now: number): void {
    if (this.inspectionStartedAt > 0) this.fireCues(now)

    if (this.current === 'holding') {
      if (now - this.holdStartedAt >= this.config.holdThresholdMs) this.current = 'ready'
      this.emit(now)
    } else if (this.current === 'running' || this.current === 'inspecting') {
      this.emit(now)
    }
  }

  /** Back to a clean idle state; clears the last result. */
  reset(now: number): void {
    this.pressed.clear()
    this.current = 'idle'
    this.holdStartedAt = 0
    this.startedAt = 0
    this.resultMs = null
    this.inspectionStartedAt = 0
    this.holdFromInspection = false
    this.cue8Fired = false
    this.cue12Fired = false
    this.pendingPenalty = undefined
    this.emit(now)
  }

  // ---- internals ----------------------------------------------------------

  private displayMs(now: number): number {
    if (this.current === 'running') return Math.max(0, now - this.startedAt)
    return this.resultMs ?? 0
  }

  private progress(now: number): number {
    if (this.current === 'ready') return 1
    if (this.current !== 'holding') return 0
    const held = now - this.holdStartedAt
    if (held <= 0) return 0
    return Math.min(1, held / this.config.holdThresholdMs)
  }

  private beginHold(now: number): void {
    this.holdFromInspection = this.current === 'inspecting'
    this.pendingPenalty = undefined // the next result's grade starts fresh
    this.holdStartedAt = now
    this.transition('holding', now)
  }

  /** The ready→release moment: begin the inspection, or start the run. */
  private release(now: number): void {
    if (this.inspectionOn && this.inspectionStartedAt === 0) this.beginInspection(now)
    else this.start(now)
  }

  private beginInspection(now: number): void {
    this.inspectionStartedAt = now
    this.cue8Fired = false
    this.cue12Fired = false
    this.transition('inspecting', now)
  }

  private cancelInspection(now: number): void {
    this.inspectionStartedAt = 0
    this.holdFromInspection = false
    this.cue8Fired = false
    this.cue12Fired = false
    this.transition('idle', now)
  }

  private fireCues(now: number): void {
    const elapsed = now - this.inspectionStartedAt
    if (!this.cue8Fired && elapsed >= INSPECTION_CUE_8S) {
      this.cue8Fired = true
      for (const listener of [...this.cueListeners]) listener('8s')
    }
    if (!this.cue12Fired && elapsed >= INSPECTION_CUE_12S) {
      this.cue12Fired = true
      for (const listener of [...this.cueListeners]) listener('12s')
    }
  }

  private start(now: number): void {
    // A run starting out of an inspection carries its verdict: the WCA
    // limits apply at the moment the solve actually starts (release).
    if (this.inspectionStartedAt > 0) {
      const elapsed = now - this.inspectionStartedAt
      this.pendingPenalty =
        elapsed >= INSPECTION_DNF_MS ? 'dnf' : elapsed >= INSPECTION_MS ? 'plus2' : undefined
    }
    // The inspection is consumed by starting the solve — clearing the start
    // time is what *cancels* the 8 s / 12 s cues: update() gates fireCues on
    // it, so an early release must not let the deadlines ring out mid-run.
    this.inspectionStartedAt = 0
    this.holdFromInspection = false
    this.cue8Fired = false
    this.cue12Fired = false
    this.startedAt = now
    this.transition('running', now)
  }

  private stop(now: number): void {
    this.resultMs = Math.max(0, now - this.startedAt)
    // The inspection belonged to this solve — consumed. The penalty stays:
    // the stopped readout and the solved listeners still need it, and the
    // next beginHold() clears it.
    this.inspectionStartedAt = 0
    this.holdFromInspection = false
    this.cue8Fired = false
    this.cue12Fired = false
    this.transition('stopped', now)
    for (const listener of [...this.solvedListeners]) listener(this.resultMs, this.pendingPenalty)
  }

  private transition(state: TimerState, now: number): void {
    this.current = state
    this.emit(now)
  }

  private emit(now: number): void {
    const snapshot = this.snapshot(now)
    for (const listener of [...this.snapshotListeners]) listener(snapshot)
  }
}
