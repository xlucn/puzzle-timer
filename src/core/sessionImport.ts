/*
 * sessionImport.ts — turn parsed csTimer sessions into library entries.
 *
 * Pure TypeScript (AGENTS.md invariant 1). The codec answers "what is in the
 * file'; this module answers "how does it become sessions here": one new
 * session per file session, names deduped by the library's own rules, the
 * file's scramble type attached before the single final switch, and the
 * imported solves handed to a callback that seeds the caller's session cache
 * before any listener hears about the new id.
 *
 * The callback runs inside SessionLibrary.create's beforeAnnounce hook. That
 * ordering is load-bearing: the list subscribes to library changes, and if it
 * loaded the new id from disk first it would bind to an empty file that the
 * seed then replaces.
 */
import type { ImportedSession } from './csTimerFormat.js'
import type { Solve } from './session.js'
import {
  MAX_NAME_LENGTH,
  SessionLibrary,
  type SessionEntry,
} from './sessionLibrary.js'

export interface SessionImportHooks {
  /** Seed the session for `entry` before the library announces it. */
  onSession: (entry: SessionEntry, solves: readonly Solve[]) => void
}

export interface SessionImportSummary {
  sessionCount: number
  solveCount: number
  /** The first created session, made active at the end; null for an empty file. */
  firstId: string | null
}

/** A name the library will accept: trimmed, capped, and unique with a suffix. */
function uniqueSessionName(library: SessionLibrary, raw: string): string {
  const base = raw.trim().slice(0, MAX_NAME_LENGTH) || 'Imported session'
  if (library.nameError(base) === null) return base
  for (let suffix = 2; ; suffix += 1) {
    const tail = ` (${suffix})`
    const candidate = `${base.slice(0, MAX_NAME_LENGTH - tail.length)}${tail}`
    if (library.nameError(candidate) === null) return candidate
  }
}

/** The parsed solves as this app's Solve records; ids start at 1. */
function importedSolves(imported: ImportedSession): Solve[] {
  return imported.solves.map((solve, index): Solve => {
    const stored: Solve = {
      id: index + 1,
      timeMs: solve.timeMs,
      scramble: solve.scramble,
      scrambleType: imported.scrambleType,
      createdAtMs: solve.createdAtMs,
    }
    if (solve.penalty !== undefined) stored.penalty = solve.penalty
    if (solve.comment !== undefined) stored.comment = solve.comment
    return stored
  })
}

/**
 * Create one session per imported session and make the first one active.
 * Returns what was created so the caller can report a summary.
 */
export function importIntoLibrary(
  library: SessionLibrary,
  sessions: readonly ImportedSession[],
  hooks: SessionImportHooks,
): SessionImportSummary {
  let firstId: string | null = null
  let sessionCount = 0
  let solveCount = 0

  for (const imported of sessions) {
    const solves = importedSolves(imported)
    const entry = library.create(uniqueSessionName(library, imported.name), (created) => {
      // Seed first, while the new id is still unannounced; the final
      // switchTo below is the only switch the import performs.
      hooks.onSession(created, solves)
      library.setScrambleType(created.id, imported.scrambleType)
    }, false)
    if (entry === null) continue
    sessionCount += 1
    solveCount += solves.length
    firstId ??= entry.id
  }

  if (firstId !== null) library.switchTo(firstId)
  return { sessionCount, solveCount, firstId }
}
