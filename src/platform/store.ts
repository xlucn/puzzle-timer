/*
 * store.ts — persistence for the solve list.
 *
 * Node-only (AGENTS.md rule 2): `fs`/`path`/`os` live here. Note that the XDG
 * data directory is read from the environment rather than via
 * `GLib.get_user_data_dir()` — rule 3 keeps every `gi:*` import inside src/ui/,
 * and the two agree: `XDG_DATA_HOME` when it is absolute (per the spec a
 * relative value is ignored), otherwise `~/.local/share`.
 *
 * Layout: one JSON file per session under `<data>/cstimer-gtk/sessions/`, so
 * M3's "switch session" is a different file rather than a migration:
 *
 *   ~/.local/share/cstimer-gtk/sessions/default.json
 *
 * Writes are atomic — the bytes go to `<file>.tmp` first and are renamed over
 * the target, so a crash mid-write can never truncate the session. They are
 * also debounced (a solve every few seconds does not deserve an fsync each
 * time): `scheduleSave()` serialises *now* and writes a moment later, and
 * `flush()` writes whatever is still pending. The window's close handler and
 * the process's exit hook both call `flush()`, so a solve recorded a
 * millisecond before quitting still survives.
 *
 * A file that cannot be parsed is moved aside (`*.corrupt-<timestamp>`) and
 * reported instead of being overwritten — losing a whole session silently
 * would be the worst possible failure for a timer.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Solve } from '../core/session.js'

/** Bumped only when the on-disk shape changes incompatibly. */
export const SESSION_FILE_VERSION = 1

const APP_DIR = 'cstimer-gtk'
const SESSION_SUBDIR = 'sessions'
const DEFAULT_SESSION = 'default'

/** Coalesces the writes that arrive while a solve is being recorded. */
const SAVE_DELAY_MS = 250

function dataHome(): string {
  const xdg = process.env.XDG_DATA_HOME
  if (xdg !== undefined && path.isAbsolute(xdg)) return xdg
  return path.join(os.homedir(), '.local', 'share')
}

/** Absolute path of the session file this build persists to. */
export function sessionFilePath(): string {
  return path.join(dataHome(), APP_DIR, SESSION_SUBDIR, `${DEFAULT_SESSION}.json`)
}

export interface LoadResult {
  /** Solves read from disk — empty when there is no file (or it was unreadable). */
  solves: Solve[]
  /** Human-readable note when the file had to be moved aside or partly skipped. */
  notice: string | null
}

function isSolve(value: unknown): value is Solve {
  if (typeof value !== 'object' || value === null) return false
  const solve = value as Record<string, unknown>
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  return (
    finite(solve.id) &&
    Number.isInteger(solve.id) &&
    solve.id >= 0 &&
    finite(solve.timeMs) &&
    solve.timeMs >= 0 &&
    typeof solve.scramble === 'string' &&
    typeof solve.scrambleType === 'string' &&
    finite(solve.createdAtMs)
  )
}

/**
 * Read the session file. Missing file → no solves and no notice; anything
 * else that cannot be understood is moved aside and reported.
 */
export function loadSession(): LoadResult {
  const file = sessionFilePath()

  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { solves: [], notice: null }
    return { solves: [], notice: `${file} could not be read: ${messageOf(error)}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { solves: [], notice: quarantine(file, 'not valid JSON') }
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { solves?: unknown }).solves) ||
    (parsed as { version?: unknown }).version !== SESSION_FILE_VERSION
  ) {
    return { solves: [], notice: quarantine(file, 'unrecognised format') }
  }

  const entries = (parsed as { solves: unknown[] }).solves
  const solves: Solve[] = []
  let skipped = 0
  for (const entry of entries) {
    if (isSolve(entry)) solves.push(entry)
    else skipped += 1
  }

  return {
    solves,
    notice: skipped > 0 ? `${file}: skipped ${skipped} unreadable solve(s)` : null,
  }
}

/**
 * Serialise now, write in a moment. Serialising eagerly matters: the session
 * array keeps changing while the debounce clock runs, and the JSON that gets
 * written must describe the state the listener saw.
 */
export function scheduleSave(solves: readonly Solve[]): void {
  pending = `${JSON.stringify({ version: SESSION_FILE_VERSION, solves }, null, 2)}\n`
  if (writeTimer !== null) return
  writeTimer = setTimeout(() => {
    writeTimer = null
    flush()
  }, SAVE_DELAY_MS)
  // Never keep the process (or the loop) alive just for a pending write.
  writeTimer.unref?.()
}

/** Write any pending change immediately. Safe to call when nothing is pending. */
export function flush(): void {
  if (writeTimer !== null) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  if (pending === null) return

  const data = pending
  const file = sessionFilePath()
  const temp = `${file}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(temp, data, 'utf8')
    fs.renameSync(temp, file)
    pending = null
  } catch (error) {
    // Keep the data and try again at the next save/flush rather than dropping it.
    pending = data
    console.error(`[store] could not write ${file}: ${messageOf(error)}`)
  }
}

let pending: string | null = null
let writeTimer: NodeJS.Timeout | null = null

// Last line of defence: the window's close handler already flushes, but a quit
// path that skips it (SIGTERM, a crash in a teardown handler) still lands here.
process.once('exit', () => flush())

function quarantine(file: string, why: string): string {
  const backup = `${file}.corrupt-${Date.now()}`
  try {
    fs.renameSync(file, backup)
    return `${file} was ${why}; moved to ${backup}`
  } catch (error) {
    return `${file} was ${why} and could not be moved aside: ${messageOf(error)}`
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
