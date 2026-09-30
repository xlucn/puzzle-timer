/*
 * scrambleFeed.ts — keeps the next scramble one step ahead of the solver.
 *
 * Architecture rule (see AGENTS.md): pure TypeScript — no `gi:*`, no Node
 * APIs. Generation itself is injected as a plain `(type) => Promise<string>`
 * (in the app that promise comes from the worker in src/scramble/, which is
 * why a 1.2 s 4x4 scramble never blocks the UI), so everything about *when*
 * to generate, what to display and what to do with a late result is decided
 * here and can be tested with hand-resolved promises.
 *
 * Two scrambles exist at any time:
 *
 *   scramble  what the panel shows — the scramble to solve next
 *   warm      pre-generated for the moment the solve finishes
 *
 *   start() / setType() / refresh() ──▶ scramble = null, generating…
 *        …generation lands ──▶ scramble = text, then warm starts generating
 *   advance()  (a solve finished) ──▶ scramble = warm, warm regenerates
 *
 * Results arrive out of order whenever the type changes mid-generation: a
 * request is stamped with a sequence number and dropped unless it is still
 * the newest request for the type that is now selected.
 */

export interface ScrambleFeedState {
  /** Scramble type currently selected. */
  type: string
  /** The scramble to solve, or null while one is being generated. */
  scramble: string | null
  /** Why no scramble is available (or why the warm one failed), if known. */
  error: string | null
}

export type Unsubscribe = () => void
type Listener = (state: ScrambleFeedState) => void

type Role = 'current' | 'warm'

interface Inflight {
  /** Stamp used to recognise (and discard) superseded results. */
  seq: number
  /** What to do with the result — may be promoted from 'warm' to 'current'. */
  role: Role
}

export interface ScrambleFeedOptions {
  /** Type to open with. */
  type: string
  /** Generates one scramble; rejects (or resolves empty) when it cannot. */
  generate: (type: string) => Promise<string>
}

const EMPTY_SCRAMBLE = 'the scrambler returned an empty scramble'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class ScrambleFeed {
  private readonly generate: (type: string) => Promise<string>
  private currentType: string
  private scrambleText: string | null = null
  private warm: string | null = null
  private inflight: Inflight | null = null
  private failure: string | null = null
  private seq = 0
  private readonly listeners = new Set<Listener>()

  constructor(options: ScrambleFeedOptions) {
    this.generate = options.generate
    this.currentType = options.type
  }

  get state(): ScrambleFeedState {
    return { type: this.currentType, scramble: this.scrambleText, error: this.failure }
  }

  /** Subscribe to every state change. Returns an unsubscribe fn. */
  subscribe(listener: Listener): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Ask for the first scramble. Does nothing if one is under way already. */
  start(): void {
    if (this.inflight !== null || this.scrambleText !== null) return
    this.begin('current')
  }

  /**
   * A solve finished: show the scramble that was kept warm, and start
   * warming the one after it. If the warm one is still being generated it is
   * promoted rather than thrown away; if generation failed, retry once.
   */
  advance(): void {
    if (this.inflight?.role === 'warm') {
      this.inflight.role = 'current'
      this.scrambleText = null
      this.failure = null
      this.emit()
      return
    }
    if (this.inflight !== null) return // the displayed scramble is still coming

    if (this.warm !== null) {
      // A failure would have left warm null, so this always carries on clean.
      this.scrambleText = this.warm
      this.warm = null
      this.emit()
      this.ensureWarm()
      return
    }

    this.begin('current')
  }

  /** Switch scramble type; anything in flight for the old type is dropped. */
  setType(type: string): void {
    if (type === this.currentType) return
    this.currentType = type
    this.restart()
  }

  /** Throw the current scramble away and make a new one of the same type. */
  refresh(): void {
    this.restart()
  }

  // ---- internals ----------------------------------------------------------

  private restart(): void {
    this.seq++ // in-flight results now belong to a scramble we no longer want
    this.inflight = null
    this.warm = null
    this.begin('current')
  }

  private ensureWarm(): void {
    if (this.scrambleText === null || this.warm !== null || this.inflight !== null) return
    if (this.failure !== null) return // a type that just failed: don't hammer it
    this.begin('warm')
  }

  private begin(role: Role): void {
    const type = this.currentType
    const seq = ++this.seq
    this.inflight = { seq, role }
    if (role === 'current') {
      this.scrambleText = null
      this.failure = null
      this.emit() // warming up changes no visible state, so it stays quiet
    }

    let pending: Promise<string>
    try {
      pending = this.generate(type)
    } catch (error) {
      pending = Promise.reject(error)
    }
    pending.then(
      (text) => this.settle(seq, type, text, null),
      (error) => this.settle(seq, type, null, error),
    )
  }

  /** Land a result, unless a newer request or a type change superseded it. */
  private settle(seq: number, type: string, text: string | null, error: unknown): void {
    if (this.inflight?.seq !== seq || this.currentType !== type) return
    const role = this.inflight.role
    this.inflight = null

    const failure =
      error !== null ? messageOf(error) : text === '' ? EMPTY_SCRAMBLE : null
    if (failure !== null) {
      this.failure = failure
      this.emit()
      return
    }

    if (role === 'current') {
      this.scrambleText = text
      this.failure = null
      this.emit()
      this.ensureWarm()
    } else {
      this.warm = text // not part of the visible state — nothing to announce
    }
  }

  private emit(): void {
    const state = this.state
    for (const listener of [...this.listeners]) listener(state)
  }
}
