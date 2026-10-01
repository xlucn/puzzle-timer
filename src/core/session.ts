/*
 * session.ts — the solve list: record, delete, restore.
 *
 * Architecture rule (see AGENTS.md): pure TypeScript — no `gi:*`, no Node
 * APIs. Persistence lives in src/platform/store.ts; this module only knows
 * about arrays, so every rule below is unit-testable.
 *
 * Ordering and identity:
 *   - solves are stored oldest → newest, and that order *is* the solve
 *     numbering (#1 is the first solve of the session);
 *   - `id` is a small integer assigned here and persisted as-is, so a solve
 *     keeps its identity through deletes and restarts (the list view keys its
 *     rows on it, which is what makes delete/restore trivial);
 *   - ids are never reused while the session lives: `nextId` only climbs.
 *
 * Deletion is always two-step — `remove()` hands back the solve *and* the
 * position it had, and `restore()` puts it back exactly there. That is what
 * makes the undo toast work without keeping a second copy of history.
 */

export interface Solve {
  /** Stable identity, unique within the session; never reused. */
  id: number
  /** Measured time in milliseconds. */
  timeMs: number
  /** The scramble this solve was performed on ('' if none was ready). */
  scramble: string
  /** Scramble type id, e.g. '333' (see src/core/scrambleTypes.ts). */
  scrambleType: string
  /** Wall-clock time the solve finished, in ms since the epoch. */
  createdAtMs: number
}

/** What the timer hands over when a solve finishes (the session assigns `id`). */
export type NewSolve = Omit<Solve, 'id'>

/** A removed solve plus where it belongs, so `restore()` can undo the removal. */
export interface RemovedSolve {
  solve: Solve
  /** Chronological index the solve occupied at the moment it was removed. */
  position: number
}

export type SessionChange =
  | { kind: 'added'; solve: Solve; position: number }
  | { kind: 'removed'; removed: RemovedSolve }
  | { kind: 'restored'; solve: Solve; position: number }

export type Unsubscribe = () => void
type Listener = (change: SessionChange) => void

export class Session {
  private items: Solve[]
  private nextId: number
  private readonly listeners = new Set<Listener>()

  /** `initial` is copied — the caller may own that array (the file loader does). */
  constructor(initial: readonly Solve[] = []) {
    this.items = [...initial]
    this.nextId = this.items.reduce((max, solve) => Math.max(max, solve.id), 0) + 1
  }

  /**
   * The solves, oldest first. Read-only by contract: mutate through the
   * methods below so listeners (and the save that follows) always see a
   * change event rather than a silently edited array.
   */
  get solves(): readonly Solve[] {
    return this.items
  }

  get size(): number {
    return this.items.length
  }

  /** The solve with this id, or undefined if it is not (or no longer) there. */
  find(id: number): Solve | undefined {
    return this.items.find((solve) => solve.id === id)
  }

  /** Chronological index of a solve, or -1. */
  indexOf(id: number): number {
    return this.items.findIndex((solve) => solve.id === id)
  }

  /** Append a finished solve; returns it with its assigned id. */
  add(solve: NewSolve): Solve {
    // Explicit fields, id first: the session file is meant to be readable
    // (and hand-editable), and NewSolve omits `id` at the type level -- so
    // don't let a runtime spread smuggle one in either.
    const { timeMs, scramble, scrambleType, createdAtMs } = solve
    const stored: Solve = { id: this.nextId++, timeMs, scramble, scrambleType, createdAtMs }
    this.items.push(stored)
    this.emit({ kind: 'added', solve: stored, position: this.items.length - 1 })
    return stored
  }

  /** Remove a solve by id. Returns what was removed, or null if unknown. */
  remove(id: number): RemovedSolve | null {
    const position = this.indexOf(id)
    if (position < 0) return null
    const [solve] = this.items.splice(position, 1)
    const removed: RemovedSolve = { solve, position }
    this.emit({ kind: 'removed', removed })
    return removed
  }

  /**
   * Put a removed solve back where it was. A position beyond the current end
   * (someone deleted further solves in between) clamps to the end, and a
   * solve that is already present is left alone — restore must be idempotent,
   * because a toast can outlive the row it belongs to.
   */
  restore(removed: RemovedSolve): Solve | null {
    if (this.find(removed.solve.id) !== undefined) return null

    const position = Math.min(Math.max(removed.position, 0), this.items.length)
    this.items.splice(position, 0, removed.solve)
    // An id from before a restart can exceed this run's counter.
    if (removed.solve.id >= this.nextId) this.nextId = removed.solve.id + 1

    this.emit({ kind: 'restored', solve: removed.solve, position })
    return removed.solve
  }

  /** Subscribe to every change. Returns an unsubscribe fn. */
  subscribe(listener: Listener): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(change: SessionChange): void {
    for (const listener of [...this.listeners]) listener(change)
  }
}
