/*
 * csTimerFormat.ts — the csTimer data-file codec.
 *
 * Pure TypeScript (AGENTS.md invariant 1): reading and writing the file has
 * no `gi:` and no Node I/O. The UI owns the file chooser and the toasts; this
 * module owns the shape, and round-trip tests are its contract.
 *
 * The format, read out of csTimer's `src/js/export.js`,
 * `src/js/lib/storage.js` and `src/js/lib/tdconverter.js` (PLAN.md §5):
 *
 *   {
 *     "session1": [ [[penalty, timeMs, …phaseSplits], scramble, comment,
 *                    dateEpochSecs], … ],
 *     …
 *     "properties": {
 *       "sessionN": 4,
 *       "sessionData": "{\"1\":{\"name\":\"…\",\"opt\":{\"scrType\":\"333\",
 *                        \"phases\":[]},\"rank\":1}, …}"
 *     }
 *   }
 *
 * Penalty is index 0 of the inner array: 0 = OK, 2000 = +2, −1 = DNF. The
 * time is raw milliseconds, so it maps straight onto Solve.timeMs. Phase
 * splits have no field here and are counted, not silently forgotten.
 *
 * Export carries `properties`: csTimer's `loadData()` clears its settings
 * when it sees one, and `storage.importAll()` overwrites its slots rather
 * than merging, so importing *into* csTimer is a restore (PLAN.md decision
 * 12). `sessionData` is the load-bearing half; a real csTimer export omits
 * the `sessionN` count and derives it from the keys, so writing both is
 * harmless.
 */
import { MAX_COMMENT_LENGTH, type Solve } from './session.js'
import { MAX_NAME_LENGTH } from './sessionLibrary.js'
import { SCRAMBLE_DEFAULT_TYPE, isScrambleType } from './scrambleTypes.js'
import type { Penalty } from './time.js'

/** One solve as the codec reads it; the caller assigns the session type. */
export interface ImportedSolve {
  timeMs: number
  scramble: string
  comment?: string
  createdAtMs: number
  penalty?: Penalty
}

/** One file session, after validation and ordering. */
export interface ImportedSession {
  name: string
  scrambleType: string
  /** csTimer's display order; ties keep their file order. */
  rank: number
  solves: ImportedSolve[]
}

export interface CsTimerImport {
  sessions: ImportedSession[]
  /** Human-readable notes for stderr — never rendered as a raw key. */
  warnings: string[]
}

/** What export needs from a session; the UI supplies these from the library. */
export interface ExportSession {
  name: string
  scrambleType?: string
  solves: readonly Solve[]
}

/** A file-level problem: not JSON, no sessions, or not a csTimer object. */
export class CsTimerFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CsTimerFormatError'
  }
}

const PHASE_SPLITS_INDEX = 2
const PENALTY_OK = 0
const PENALTY_PLUS2 = 2000
const PENALTY_DNF = -1

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** `0` / `2000` / `−1`, or undefined for an unknown marker (and a warning). */
function readPenalty(value: unknown, warn: (reason: string) => void): Penalty | undefined {
  if (value === PENALTY_PLUS2) return 'plus2'
  if (value === PENALTY_DNF) return 'dnf'
  if (value === PENALTY_OK || value === undefined) return undefined
  warn(`unknown penalty ${JSON.stringify(value)} treated as OK`)
  return undefined
}

function writePenalty(penalty: Penalty | undefined): number {
  if (penalty === 'plus2') return PENALTY_PLUS2
  if (penalty === 'dnf') return PENALTY_DNF
  return PENALTY_OK
}

function readComment(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim().slice(0, MAX_COMMENT_LENGTH)
  return text.length > 0 ? text : undefined
}

function readSessionData(
  properties: Record<string, unknown> | null,
  warnings: string[],
): Record<string, unknown> {
  const raw = properties?.sessionData
  if (raw === undefined) return {}
  if (record(raw)) return raw
  if (typeof raw !== 'string') {
    warnings.push('properties.sessionData is not a JSON string')
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (record(parsed)) return parsed
    warnings.push('properties.sessionData is not an object')
  } catch {
    warnings.push('properties.sessionData is not valid JSON')
  }
  return {}
}

/** A name that is usable in this app, or a neutral fallback. */
function readName(meta: Record<string, unknown> | undefined, index: number): string {
  const raw = meta?.name
  // csTimer stores whatever the user typed, including a bare number (the
  // 2017 sessions in a real export are named 9 and 12).
  const text =
    typeof raw === 'string'
      ? raw
      : typeof raw === 'number' && Number.isFinite(raw)
        ? String(raw)
        : null
  if (text === null) return `Session ${index}`
  const name = text.trim().slice(0, MAX_NAME_LENGTH)
  return name.length > 0 ? name : `Session ${index}`
}

function readScrambleType(
  meta: Record<string, unknown> | undefined,
  warnings: string[],
  index: number,
): string {
  const opt = meta?.opt
  const raw = record(opt) ? opt.scrType : undefined
  if (raw === undefined) return SCRAMBLE_DEFAULT_TYPE
  if (typeof raw === 'string' && isScrambleType(raw)) return raw
  warnings.push(`session${index}: unknown scramble type ${JSON.stringify(raw)}; using the default`)
  return SCRAMBLE_DEFAULT_TYPE
}

function readSolves(
  rows: unknown,
  index: number,
  warnings: string[],
): { solves: ImportedSolve[]; phaseSplits: number } {
  if (!Array.isArray(rows)) {
    warnings.push(`session${index} is not an array`)
    return { solves: [], phaseSplits: 0 }
  }

  const solves: ImportedSolve[] = []
  let skipped = 0
  let phaseSplits = 0

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) {
      skipped += 1
      continue
    }
    const values = row[0]
    if (!Array.isArray(values) || values.length < 2 || !finite(values[1]) || values[1] < 0) {
      skipped += 1
      continue
    }
    // Older csTimer exports omit the date element entirely; a present but
    // non-numeric one is still a malformed row. Missing means "unknown" and
    // maps to the epoch, which the UI renders as a blank timestamp.
    const rawDate = row[3]
    const date = rawDate === undefined || rawDate === null ? 0 : rawDate
    if (!finite(date)) {
      skipped += 1
      continue
    }
    if (values.length > PHASE_SPLITS_INDEX) {
      phaseSplits += values.length - PHASE_SPLITS_INDEX
    }

    const solve: ImportedSolve = {
      timeMs: values[1],
      scramble: typeof row[1] === 'string' ? row[1] : '',
      createdAtMs: Math.round(date * 1000),
    }
    const penalty = readPenalty(values[0], (reason) => warnings.push(`session${index}: ${reason}`))
    if (penalty !== undefined) solve.penalty = penalty
    const comment = readComment(row[2])
    if (comment !== undefined) solve.comment = comment
    solves.push(solve)
  }

  if (skipped > 0) warnings.push(`session${index}: skipped ${skipped} malformed solve(s)`)
  if (phaseSplits > 0) warnings.push(`session${index}: dropped ${phaseSplits} phase split(s)`)

  // The solve list is oldest → newest by contract (src/core/session.ts).
  solves.sort((a, b) => a.createdAtMs - b.createdAtMs)
  return { solves, phaseSplits }
}

/**
 * Parse a csTimer data file. Per-session problems become warnings and the
 * rest of the file still imports; only "this is not a csTimer object" throws.
 */
export function parseCsTimerData(text: string): CsTimerImport {
  let data: unknown
  try {
    // A file saved by a Windows editor can carry a UTF-8 BOM, which
    // JSON.parse rejects as an unexpected first character.
    data = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new CsTimerFormatError('The file is not valid JSON')
  }
  if (!record(data)) throw new CsTimerFormatError('The file is not a csTimer data object')

  const warnings: string[] = []
  const properties = record(data.properties) ? data.properties : null
  if (properties === null) {
    warnings.push('properties is missing; reading the session keys only')
  }

  const declared = properties?.sessionN
  const declaredCount =
    finite(declared) && Number.isInteger(declared) && declared > 0 ? declared : 0

  // Only the keys that are actually present matter — a missing one would be
  // csTimer's "empty session". Iterating 1…sessionN instead would hang on a
  // hand-edited `sessionN` of a billion.
  const indices = [
    ...new Set(
      Object.keys(data)
        .map((key) => /^session(\d+)$/.exec(key)?.[1])
        .filter((value): value is string => value !== undefined)
        .map(Number),
    ),
  ].sort((a, b) => a - b)
  if (indices.length === 0) throw new CsTimerFormatError('The file contains no sessions')
  // csTimer's own exports carry no sessionN (its properties hold the two
  // legacy name/type strings and the sessionData JSON), so its absence is
  // normal and only a declared count above the present keys is suspicious.
  if (declaredCount > indices.length) {
    warnings.push(
      `properties.sessionN is ${declaredCount} but only ${indices.length} session list(s) are present`,
    )
  }

  const sessionData = readSessionData(properties, warnings)
  const imported: ImportedSession[] = []

  for (const index of indices) {
    const rows = data[`session${index}`]
    // A present non-array is a malformed file; readSolves reports it.
    const metaValue = sessionData[String(index)]
    const meta = record(metaValue) ? (metaValue as Record<string, unknown>) : undefined
    const rawRank = meta?.rank
    const rank = finite(rawRank) ? rawRank : index
    const { solves } = readSolves(rows, index, warnings)
    imported.push({
      name: readName(meta, index),
      scrambleType: readScrambleType(meta, warnings, index),
      rank,
      solves,
    })
  }

  if (imported.length === 0) throw new CsTimerFormatError('The file contains no usable sessions')
  imported.sort((a, b) => a.rank - b.rank)
  return { sessions: imported, warnings }
}

function exportScrambleType(session: ExportSession): string {
  if (session.scrambleType !== undefined && isScrambleType(session.scrambleType)) {
    return session.scrambleType
  }
  // A pre-type session index can have solves whose own type is known; the
  // newest one is the best answer csTimer's single per-session type allows.
  for (let index = session.solves.length - 1; index >= 0; index -= 1) {
    const type = session.solves[index].scrambleType
    if (isScrambleType(type)) return type
  }
  return SCRAMBLE_DEFAULT_TYPE
}

function exportName(session: ExportSession, index: number): string {
  const name = session.name.trim().slice(0, MAX_NAME_LENGTH)
  return name.length > 0 ? name : `Session ${index}`
}

function exportSolve(solve: Solve): unknown[] {
  return [
    [writePenalty(solve.penalty), solve.timeMs],
    solve.scramble,
    solve.comment ?? '',
    Math.floor(solve.createdAtMs / 1000),
  ]
}

/**
 * Serialise sessions for csTimer. `properties.sessionN` and `sessionData`
 * are always present, in that order's JSON shape, because csTimer needs both
 * to restore the full list.
 */
export function formatCsTimerData(sessions: readonly ExportSession[]): string {
  const data: Record<string, unknown> = {}
  const sessionData: Record<string, unknown> = {}

  sessions.forEach((session, offset) => {
    const index = offset + 1
    data[`session${index}`] = session.solves.map(exportSolve)
    sessionData[String(index)] = {
      name: exportName(session, index),
      opt: { scrType: exportScrambleType(session), phases: [] },
      rank: index,
    }
  })

  data.properties = {
    sessionN: sessions.length,
    sessionData: JSON.stringify(sessionData),
  }
  return JSON.stringify(data)
}
