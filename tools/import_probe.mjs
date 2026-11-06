/*
 * import_probe.mjs — the csTimer import writes real session files.
 *
 * Complements the codec tests: parses a csTimer-shaped file, turns it into
 * library entries through the same core helper main.ts uses, saves through
 * src/platform/store.ts, then re-reads the index and every session from disk.
 * It also exports the reloaded data and parses it back, so the two directions
 * meet in the middle.
 *
 * Usage: node --import tsx tools/import_probe.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { formatCsTimerData, parseCsTimerData } from '../src/core/csTimerFormat.js'
import { importIntoLibrary } from '../src/core/sessionImport.js'
import { Session } from '../src/core/session.js'
import { SessionLibrary } from '../src/core/sessionLibrary.js'
import * as store from '../src/platform/store.js'

const log = (...args) => console.error('[import]', ...args)
let failures = 0
const check = (ok, what) => {
  log(`${ok ? 'PASS' : 'FAIL'} — ${what}`)
  if (!ok) failures += 1
}

const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-timer-import-'))
process.env.XDG_DATA_HOME = dataHome

const file = {
  session1: [
    [[0, 12_345], "R U R'", '', 1_700_000_000],
    [[2000, 10_000], 'F2 D', 'first', 1_700_000_100],
    [[-1, 5_000], '', '', 1_700_000_200],
  ],
  session2: [[[0, 60_000], 'Uw R', 'big cube', 1_700_000_300]],
  properties: {
    sessionN: 2,
    sessionData: JSON.stringify({
      1: { name: 'Imported 3x3', opt: { scrType: '333', phases: [] }, rank: 1 },
      2: { name: 'Imported 4x4', opt: { scrType: '444wca', phases: [] }, rank: 2 },
    }),
  },
}

const parsed = parseCsTimerData(JSON.stringify(file))
check(parsed.sessions.length === 2 && parsed.warnings.length === 0, 'the sample parses cleanly')

const library = new SessionLibrary()
const cache = new Map()
const summary = importIntoLibrary(library, parsed.sessions, {
  onSession: (entry, solves) => {
    const session = new Session(solves)
    session.subscribe(() => store.scheduleSave(entry.id, session.solves))
    cache.set(entry.id, session)
  },
})

check(
  summary.sessionCount === 2 && summary.solveCount === 4 && summary.firstId === 'imported-3x3',
  `created 2 sessions / 4 solves (${JSON.stringify(summary)})`,
)
check(
  library.entries.map((entry) => entry.name).join(',') === 'Default,Imported 3x3,Imported 4x4',
  `names are in file order (${library.entries.map((entry) => entry.name).join(' → ')})`,
)
check(
  library.find('imported-3x3')?.scrambleType === '333' &&
    library.find('imported-4x4')?.scrambleType === '444wca',
  'the file scramble types reached the index',
)

// `importIntoLibrary` schedules nothing itself; main.ts's callback does.
for (const [id, session] of cache) store.scheduleSave(id, session.solves)
store.saveIndex(library.entries, library.activeId)
store.flush()

const reloaded = store.loadIndex()
check(reloaded.notice === null, 'the index reloads without a notice')
check(
  reloaded.sessions.map((entry) => entry.name).join(',') === 'Default,Imported 3x3,Imported 4x4',
  `the index holds the imported sessions (${reloaded.sessions.map((e) => e.name).join(' → ')})`,
)

const three = store.loadSession('imported-3x3')
check(
  three.notice === null &&
    three.solves.length === 3 &&
    three.solves[1].penalty === 'plus2' &&
    three.solves[1].comment === 'first' &&
    three.solves[2].penalty === 'dnf',
  `the 3x3 file keeps 3 solves with penalties and comments (${JSON.stringify(three.solves.map((s) => [s.timeMs, s.penalty, s.comment]))})`,
)
check(
  three.solves.every((solve) => solve.scrambleType === '333'),
  'every imported solve carries the session type',
)

const exported = formatCsTimerData(
  reloaded.sessions.map((entry) => ({
    name: entry.name,
    ...(entry.scrambleType === undefined ? {} : { scrambleType: entry.scrambleType }),
    solves: store.loadSession(entry.id).solves,
  })),
)
const back = parseCsTimerData(exported)
check(
  back.sessions.map((session) => `${session.name}:${session.solves.length}`).join(',') ===
    'Default:0,Imported 3x3:3,Imported 4x4:1',
  `the export parses back to the same lists (${back.sessions.map((s) => `${s.name}:${s.solves.length}`).join(', ')})`,
)

fs.rmSync(dataHome, { recursive: true, force: true })
log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
