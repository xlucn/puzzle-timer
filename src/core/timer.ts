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
 * GTK does not report keyboard auto-repeat (a held key produces repeated
 * *press* events and a single *release*), so keyDown() ignores any key it has
 * already seen and not yet seen released. That dedup lives here rather than in
 * the UI layer precisely so it can be tested.
 */

export type TimerState = 'idle' | 'holding' | 'ready' | 'running' | 'stopped'

export interface TimerConfig {
  /** How long the start key must be held before the timer turns "ready". */
  holdThresholdMs: number
  /** Identity of the key that starts the timer (the UI sends 'space'). */
  startKey: string
}

export const DEFAULT_TIMER_CONFIG: TimerConfig = {
  holdThresholdMs: 300,
  startKey: 'space',
}

export interface TimerSnapshot {
  /** Current state. */
  state: TimerState
  /** Time currently displayed, in milliseconds. */
  elapsedMs: number
  /** 0..1 progress through the hold threshold while holding, 1 when ready. */
  holdProgress: number
}

export type Unsubscribe = () => void
type SnapshotListener = (snapshot: TimerSnapshot) => void
type SolvedListener = (elapsedMs: number) => void

export class Timer {
  private readonly config: TimerConfig
  private current: TimerState = 'idle'
  private readonly pressed = new Set<string>()
  private holdStartedAt = 0
  private startedAt = 0
  private resultMs: number | null = null

  private readonly snapshotListeners = new Set<SnapshotListener>()
  private readonly solvedListeners = new Set<SolvedListener>()

  constructor(config: Partial<TimerConfig> = {}) {
    this.config = { ...DEFAULT_TIMER_CONFIG, ...config }
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

  /** Subscribe to every state/snapshot change. Returns an unsubscribe fn. */
  subscribe(listener: SnapshotListener): Unsubscribe {
    this.snapshotListeners.add(listener)
    return () => this.snapshotListeners.delete(listener)
  }

  /** Called once per completed solve, with the elapsed time in ms. */
  onSolved(listener: SolvedListener): Unsubscribe {
    this.solvedListeners.add(listener)
    return () => this.solvedListeners.delete(listener)
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
      this.start(now)
    } else if (this.current === 'holding') {
      // Released before the threshold: cancel rather than start.
      if (now - this.holdStartedAt >= this.config.holdThresholdMs) this.start(now)
      else this.transition('idle', now)
    }
  }

  /**
   * Drive time-based transitions (hold threshold) and refresh the displayed
   * value. Call it on a tick while holding or running.
   */
  update(now: number): void {
    if (this.current === 'holding') {
      if (now - this.holdStartedAt >= this.config.holdThresholdMs) this.current = 'ready'
      this.emit(now)
    } else if (this.current === 'running') {
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
    this.holdStartedAt = now
    this.transition('holding', now)
  }

  private start(now: number): void {
    this.startedAt = now
    this.transition('running', now)
  }

  private stop(now: number): void {
    this.resultMs = Math.max(0, now - this.startedAt)
    this.transition('stopped', now)
    for (const listener of [...this.solvedListeners]) listener(this.resultMs)
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
