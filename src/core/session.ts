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

import type { Penalty } from './time.js'

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
  /**
   * WCA-style result penalty; absent means OK (see src/core/time.ts).
   * Optional so session files written before penalties existed still load
   * unchanged.
   */
  penalty?: Penalty
  /** Free-text note shown next to the time. */
  comment?: string
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
  /** A penalty was set (`penalty` present) or cleared back to OK (absent). */
  | { kind: 'penalty'; solve: Solve; position: number }
  /** A comment was set or replaced. */
  | { kind: 'comment'; solve: Solve; position: number }

export type Unsubscribe = () => void
type Listener = (change: SessionChange) => void

/**
 * Longest comment accepted, shared by the editor dialog and the loader: a
 * solve's note is a short aside, not a document, and a file that exceeds it
 * is skipped (with a notice) rather than truncated.
 */
export const MAX_COMMENT_LENGTH = 500

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
    // don't let a runtime spread smuggle one in either. `penalty` is
    // optional and only written when present (an inspection DNF/+2 arrives
    // with the solve itself; OK is still "absent").
    const { timeMs, scramble, scrambleType, createdAtMs, penalty } = solve
    const stored: Solve = { id: this.nextId++, timeMs, scramble, scrambleType, createdAtMs }
    if (penalty !== undefined) stored.penalty = penalty
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

  /**
   * Set (or, with `undefined`, clear) a solve's penalty. Returns the solve,
   * or null if the id is unknown. Listeners get a `'penalty'` change so the
   * row, footer and statistics all refresh from one code path.
   */
  setPenalty(id: number, penalty: Penalty | undefined): Solve | null {
    const position = this.indexOf(id)
    if (position < 0) return null
    const solve = this.items[position]
    if (solve.penalty === penalty) return solve
    if (penalty === undefined) delete solve.penalty
    else solve.penalty = penalty
    this.emit({ kind: 'penalty', solve, position })
    return solve
  }

  /**
   * Set (or, with `undefined`, clear) a solve's comment. Same contract as
   * `setPenalty` — a `'comment'` change event follows every real change.
   */
  setComment(id: number, comment: string | undefined): Solve | null {
    const position = this.indexOf(id)
    if (position < 0) return null
    const solve = this.items[position]
    const next = comment === undefined || comment === '' ? undefined : comment
    if (solve.comment === next) return solve
    if (next === undefined) delete solve.comment
    else solve.comment = next
    this.emit({ kind: 'comment', solve, position })
    return solve
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
