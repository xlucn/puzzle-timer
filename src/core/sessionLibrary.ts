/*
 * sessionLibrary.ts — the list of sessions *around* the solve lists.
 *
 * Architecture rule (see AGENTS.md): pure TypeScript — no `gi:*`, no Node
 * APIs. The library owns only metadata (`id` + `name` + the session's
 * scramble type) and which entry is active; the solves themselves stay in
 * Session (src/core/session.ts) and on disk (src/platform/store.ts), so
 * everything below is unit-testable.
 *
 * Identity vs. display:
 *   - `id` is the file name (`sessions/<id>.json`), so it is stable forever:
 *     renaming a session changes `name` only, and the file is never touched.
 *     It is derived from the name, lowercase and hyphenated ('Meet weekly' →
 *     'meet-weekly'), with a numeric suffix when that collides.
 *   - `name` is what the UI shows. Names are unique case-insensitively — the
 *     header lists them as a radio group, and two "Practice" rows would make
 *     that list useless.
 *
 * Invariant: the library is never empty. A fresh install constructs it with
 * no entries at all and gets a 'Default' session, so callers can always read
 * `active` without a null check; the last session cannot be deleted.
 *
 * Every mutation emits — `create()` emits created *and* switched, because a
 * new session also becomes the active one — and listeners are expected to do
 * one idempotent re-render per change rather than branching on the kind.
 */
import type { Unsubscribe } from './session.js'

/** One session as the index on disk knows it. */
export interface SessionEntry {
  /** File id: lowercase, hyphenated, unique, never changes. */
  id: string
  /** Display name: trimmed, non-empty, unique case-insensitively. */
  name: string
  /**
   * The scramble type this session solves (e.g. '444wca'); absent means the
   * app default (SCRAMBLE_DEFAULT_TYPE). Remembered per session so switching
   * restores the type dropdown — applySessionType in main.ts.
   */
  scrambleType?: string
}

export type LibraryChange =
  | { kind: 'created'; entry: SessionEntry }
  | { kind: 'renamed'; entry: SessionEntry }
  | { kind: 'deleted'; entry: SessionEntry }
  | { kind: 'switched'; id: string; previousId: string }
  /** The session's scramble type changed (the index save persists it). */
  | { kind: 'retyped'; entry: SessionEntry }

/** Why a display name cannot be used (`exceptId` aside). */
export type NameError = 'empty' | 'long' | 'duplicate'

type Listener = (change: LibraryChange) => void

/** Long enough for a real name, short enough for the header button. */
export const MAX_NAME_LENGTH = 40

/** Used when a name slugifies to nothing (e.g. a purely non-Latin name). */
const FALLBACK_SLUG = 'session'
const DEFAULT_ENTRY: SessionEntry = { id: 'default', name: 'Default' }

/**
 * The file id for a name: lowercase, accents folded, everything that is not
 * a letter or digit collapsed into single hyphens. Empty result → the
 * fallback, which `uniqueId()` then disambiguates like any other collision.
 */
function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining accents left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : FALLBACK_SLUG
}

export class SessionLibrary {
  private items: SessionEntry[]
  private currentId: string
  private readonly listeners = new Set<Listener>()

  /**
   * `activeId` is honoured only when it names one of `entries`; otherwise the
   * first entry wins. Empty `entries` (fresh install) yields `Default`.
   */
  constructor(entries: readonly SessionEntry[] = [], activeId: string | null = null) {
    this.items = [...entries]
    if (this.items.length === 0) this.items.push({ ...DEFAULT_ENTRY })
    this.currentId =
      activeId !== null && this.items.some((entry) => entry.id === activeId)
        ? activeId
        : this.items[0].id
  }

  /** The sessions, in menu order (creation order). Never empty. */
  get entries(): readonly SessionEntry[] {
    return this.items
  }

  /** The active session. Non-null by the invariant above. */
  get active(): SessionEntry {
    return this.find(this.currentId) ?? this.items[0]
  }

  get activeId(): string {
    return this.active.id
  }

  find(id: string): SessionEntry | undefined {
    return this.items.find((entry) => entry.id === id)
  }

  isActive(id: string): boolean {
    return this.activeId === id
  }

  /**
   * Why `rawName` cannot be used for a session (excluding `exceptId` when
   * renaming), or null when it is fine. The name dialog binds its own
   * sensitivity and its message to this, so the UI and the library can never
   * disagree about what is acceptable.
   */
  nameError(rawName: string, exceptId: string | null = null): NameError | null {
    const name = rawName.trim()
    if (name.length === 0) return 'empty'
    if (name.length > MAX_NAME_LENGTH) return 'long'
    const taken = this.items.some(
      (entry) => entry.id !== exceptId && entry.name.toLowerCase() === name.toLowerCase(),
    )
    if (taken) return 'duplicate'
    return null
  }

  /**
   * Create a session and switch to it (a new session is what you wanted to
   * work in). Returns the entry, or null when the name is unusable.
   */
  create(rawName: string): SessionEntry | null {
    const name = rawName.trim()
    if (this.nameError(name) !== null) return null

    const entry: SessionEntry = {
      id: this.uniqueId(name),
      name,
      // A new session continues in the type you are solving right now —
      // creating "4x4 practice" from a 4x4 session must not snap the
      // dropdown back to the default.
      ...(this.active.scrambleType !== undefined
        ? { scrambleType: this.active.scrambleType }
        : {}),
    }
    this.items.push(entry)
    this.emit({ kind: 'created', entry })
    this.switchTo(entry.id)
    return entry
  }

  /**
   * Give a session its own scramble type (the UI calls this when the user
   * picks one). Emits `retyped` so main.ts's index subscription persists
   * it; an unchanged value emits nothing — same rule as Session.setPenalty.
   */
  setScrambleType(id: string, scrambleType: string): boolean {
    const index = this.items.findIndex((entry) => entry.id === id)
    if (index < 0 || this.items[index].scrambleType === scrambleType) return false

    const entry = { ...this.items[index], scrambleType }
    this.items[index] = entry
    this.emit({ kind: 'retyped', entry })
    return true
  }

  /** Rename a session; the id (and so the file) is untouched. */
  rename(id: string, rawName: string): boolean {
    const index = this.items.findIndex((entry) => entry.id === id)
    if (index < 0) return false
    const name = rawName.trim()
    if (this.nameError(name, id) !== null) return false

    // Replace, don't mutate: the caller handed us these objects (the index
    // loader keeps its array), and a shared half-renamed entry would leak.
    const entry = { ...this.items[index], name }
    this.items[index] = entry
    this.emit({ kind: 'renamed', entry })
    return true
  }

  /**
   * Delete a session. The last one is refused — an empty library would leave
   * the timer with nowhere to record. Removing the active session moves the
   * active flag to its neighbour (the next one, else the previous), so the
   * caller always has a valid session to show afterwards.
   */
  remove(id: string): boolean {
    const index = this.items.findIndex((entry) => entry.id === id)
    if (index < 0 || this.items.length === 1) return false

    const [entry] = this.items.splice(index, 1)
    this.emit({ kind: 'deleted', entry })

    if (this.currentId === id) {
      const previousId = id
      this.currentId = this.items[Math.min(index, this.items.length - 1)].id
      this.emit({ kind: 'switched', id: this.currentId, previousId })
    }
    return true
  }

  /** Make `id` active. Unknown id or no change → false, and no event. */
  switchTo(id: string): boolean {
    if (this.isActive(id) || this.find(id) === undefined) return false
    const previousId = this.currentId
    this.currentId = id
    this.emit({ kind: 'switched', id, previousId })
    return true
  }

  subscribe(listener: Listener): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** A file id for `name` that no entry is using. */
  private uniqueId(name: string): string {
    const base = slugify(name)
    if (this.find(base) === undefined) return base
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${base}-${suffix}`
      if (this.find(candidate) === undefined) return candidate
    }
  }

  private emit(change: LibraryChange): void {
    for (const listener of [...this.listeners]) listener(change)
  }
}
