/*
 * store.test.ts — the on-disk contract, exercised against a throwaway XDG
 * data dir.
 *
 * These live beside the platform code rather than in src/core (see AGENTS.md)
 * because they are the one place the migration is proved: the legacy layout
 * left a single `sessions/default.json` and no index, and the loader must
 * adopt it without losing a solve. Everything is pure Node — no display
 * server, same as the core tests.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { MAX_COMMENT_LENGTH, type Solve } from '../core/session.js'
import {
  DEFAULT_PREFERENCES,
  MAX_HOLD_THRESHOLD_MS,
  type Preferences,
} from '../core/preferences.js'
import * as store from './store.js'

/** One data home per run; the store reads it through the environment. */
const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cstimer-store-'))
const sessionsDir = () => path.join(dataHome, 'puzzle-timer', 'sessions')

const solve = (id: number): Solve => ({
  id,
  timeMs: 1000 * id,
  scramble: "R U R' U'",
  scrambleType: '333',
  createdAtMs: 1_700_000_000_000 + id,
})

const writeFile = (name: string, contents: string) => {
  fs.mkdirSync(sessionsDir(), { recursive: true })
  fs.writeFileSync(path.join(sessionsDir(), name), contents, 'utf8')
}

const filesInSessionsDir = () => (fs.existsSync(sessionsDir()) ? fs.readdirSync(sessionsDir()) : [])

beforeEach(() => {
  process.env.XDG_DATA_HOME = dataHome
  // Every test starts with no leftovers — and no queued write from the last one.
  store.flush()
  fs.rmSync(sessionsDir(), { recursive: true, force: true })
  // prefs.json *and* any `prefs.json.corrupt-*` quarantine of the last test.
  const appDir = path.dirname(store.preferencesPath())
  if (fs.existsSync(appDir)) {
    for (const name of fs.readdirSync(appDir)) {
      if (name.startsWith('prefs.json')) fs.rmSync(path.join(appDir, name), { force: true })
    }
  }
})

afterAll(() => {
  store.flush()
  fs.rmSync(dataHome, { recursive: true, force: true })
  delete process.env.XDG_DATA_HOME
})

describe('store — the index-less legacy migration', () => {
  it('adopts an index-less default.json as the Default session', () => {
    writeFile(
      'default.json',
      `${JSON.stringify({ version: 1, solves: [solve(1), solve(2)] }, null, 2)}\n`,
    )

    const index = store.loadIndex()

    expect(index.notice).toBeNull()
    expect(index.sessions).toEqual([{ id: 'default', name: 'Default' }])
    expect(index.activeId).toBe('default')

    const loaded = store.loadSession('default')
    expect(loaded.notice).toBeNull()
    expect(loaded.solves.map((each) => each.id)).toEqual([1, 2])
  })

  it('finds every session file when the index is missing entirely', () => {
    writeFile('default.json', JSON.stringify({ version: 1, solves: [] }))
    writeFile('meet-weekly.json', JSON.stringify({ version: 1, solves: [solve(1)] }))

    const index = store.loadIndex()

    expect(index.sessions).toEqual([
      { id: 'default', name: 'Default' },
      { id: 'meet-weekly', name: 'Meet weekly' },
    ])
    expect(index.activeId).toBe('default')
  })

  it('starts from nothing on a fresh install', () => {
    const index = store.loadIndex()
    expect(index).toEqual({ sessions: [], activeId: null, notice: null })
  })
})

describe('store — the index', () => {
  it('round-trips sessions, names and the active id', () => {
    store.saveIndex(
      [
        { id: 'default', name: 'Default' },
        { id: 'meet-weekly', name: 'Meet weekly' },
      ],
      'meet-weekly',
    )

    const index = store.loadIndex()

    expect(index.notice).toBeNull()
    expect(index.sessions).toEqual([
      { id: 'default', name: 'Default' },
      { id: 'meet-weekly', name: 'Meet weekly' },
    ])
    expect(index.activeId).toBe('meet-weekly')
  })

  it('falls back to the first session when the stored active id is unknown', () => {
    store.saveIndex([{ id: 'default', name: 'Default' }], 'gone')
    expect(store.loadIndex().activeId).toBe('default')
  })

  it('round-trips each session scramble type, dropping bad values', () => {
    store.saveIndex(
      [
        { id: 'default', name: 'Default' },
        { id: 'four', name: '4x4 practice', scrambleType: '444wca' },
      ],
      'four',
    )

    expect(store.loadIndex().sessions).toEqual([
      { id: 'default', name: 'Default' },
      { id: 'four', name: '4x4 practice', scrambleType: '444wca' },
    ])

    // The index is hand-editable: a non-string or empty type must not
    // reach the dropdowns, while the entry itself stays listed.
    writeFile(
      '_index.json',
      JSON.stringify({
        version: 1,
        active: 'default',
        sessions: [
          { id: 'default', name: 'Default' },
          { id: 'weird', name: 'Weird', scrambleType: 42 },
          { id: 'blank', name: 'Blank', scrambleType: '' },
        ],
      }),
    )

    expect(store.loadIndex().sessions).toEqual([
      { id: 'default', name: 'Default' },
      { id: 'weird', name: 'Weird' },
      { id: 'blank', name: 'Blank' },
    ])
  })

  it('skips unreadable entries and says so', () => {
    writeFile(
      '_index.json',
      JSON.stringify({
        version: 1,
        active: '../escape',
        sessions: [
          { id: 'default', name: 'Default' },
          { id: '../../etc/passwd', name: 'Nope' }, // never joined into a path
          { id: 'empty', name: '   ' },
          { id: 'ok', name: 'Fine' },
        ],
      }),
    )

    const index = store.loadIndex()

    expect(index.sessions).toEqual([
      { id: 'default', name: 'Default' },
      { id: 'ok', name: 'Fine' },
    ])
    expect(index.activeId).toBe('default') // the bad active id fell back
    expect(index.notice).toContain('skipped 2 unreadable session(s)')
  })

  it('quarantines an unparseable index and rebuilds from the files', () => {
    writeFile('default.json', JSON.stringify({ version: 1, solves: [solve(1)] }))
    writeFile('_index.json', '{ not json')

    const index = store.loadIndex()

    expect(index.notice).toMatch(/moved to .*\.corrupt-\d+$/)
    expect(index.sessions).toEqual([{ id: 'default', name: 'Default' }])
    expect(index.activeId).toBe('default')
    expect(filesInSessionsDir().some((name) => name.startsWith('_index.json.corrupt-'))).toBe(true)
    expect(filesInSessionsDir()).toContain('default.json') // the solves are untouched
  })

  it('quarantines an index of the wrong version rather than overwriting it', () => {
    writeFile('_index.json', JSON.stringify({ version: 99, active: 'a', sessions: [{ id: 'a', name: 'A' }] }))

    const index = store.loadIndex()

    expect(index.notice).toMatch(/unrecognised format/)
    expect(index.sessions).toEqual([]) // no session files either
    expect(filesInSessionsDir().some((name) => name.startsWith('_index.json.corrupt-'))).toBe(true)
  })
})

describe('store — session files', () => {
  it('writes atomically and reads back what it wrote', () => {
    store.scheduleSave('practice', [solve(1), solve(2)])
    store.flush()

    expect(store.loadSession('practice').solves.map((each) => each.id)).toEqual([1, 2])
    expect(filesInSessionsDir()).toContain('practice.json')
    expect(filesInSessionsDir()).not.toContain('practice.json.tmp') // renamed, not left behind
  })

  it('keeps queued writes apart per session', () => {
    store.scheduleSave('alpha', [solve(1)])
    store.scheduleSave('beta', [solve(1), solve(2)])
    store.flush()

    expect(store.loadSession('alpha').solves).toHaveLength(1)
    expect(store.loadSession('beta').solves).toHaveLength(2)
  })

  it('reports an unparseable session file instead of starting a new one', () => {
    writeFile('broken.json', 'nonsense')

    const loaded = store.loadSession('broken')

    expect(loaded.solves).toEqual([])
    expect(loaded.notice).toMatch(/not valid JSON.*moved to/)
    expect(filesInSessionsDir().some((name) => name.startsWith('broken.json.corrupt-'))).toBe(true)
  })

  it('treats a missing file as an empty session, not as damage', () => {
    expect(store.loadSession('brand-new')).toEqual({ solves: [], notice: null })
  })

  it('refuses to build a path from a malformed id', () => {
    expect(() => store.sessionFilePath('../escape')).toThrow(/invalid session id/)
    expect(() => store.sessionFilePath('UPPER')).toThrow(/invalid session id/)
    expect(() => store.sessionFilePath('')).toThrow(/invalid session id/)
  })

  it('names a session file only after its id, never its display name', () => {
    store.scheduleSave('meet-weekly', [solve(1)])
    store.flush()
    expect(filesInSessionsDir()).toContain('meet-weekly.json')
    expect(filesInSessionsDir()).not.toContain('Meet weekly.json')
  })
})

describe('store — penalties and comments', () => {
  it('round-trips a solve with a penalty and a comment', () => {
    store.scheduleSave('practice', [
      { ...solve(1), penalty: 'plus2', comment: 'lockup' },
      { ...solve(2), penalty: 'dnf' },
      solve(3), // plain OK solve — carries neither field
    ])
    store.flush()

    const { solves, notice } = store.loadSession('practice')

    expect(notice).toBeNull()
    expect(solves).toEqual([
      { ...solve(1), penalty: 'plus2', comment: 'lockup' },
      { ...solve(2), penalty: 'dnf' },
      solve(3),
    ])
  })

  it('still loads a file written before penalties existed — both fields are optional', () => {
    writeFile(
      'default.json',
      `${JSON.stringify({ version: 1, solves: [solve(1)] }, null, 2)}\n`,
    )

    expect(store.loadSession('default')).toEqual({ solves: [solve(1)], notice: null })
  })

  it('skips a solve whose penalty is not one of plus2/dnf', () => {
    writeFile(
      'practice.json',
      `${JSON.stringify(
        {
          version: 1,
          solves: [solve(1), { ...solve(2), penalty: 'plus5' }, { ...solve(3), penalty: 7 }],
        },
        null,
        2,
      )}\n`,
    )

    const { solves, notice } = store.loadSession('practice')

    expect(solves.map((each) => each.id)).toEqual([1])
    expect(notice).toMatch(/skipped 2 unreadable solve/)
  })

  it('skips a solve whose comment is malformed or absurdly long', () => {
    writeFile(
      'practice.json',
      `${JSON.stringify(
        {
          version: 1,
          solves: [
            solve(1),
            { ...solve(2), comment: 42 },
            { ...solve(3), comment: 'x'.repeat(MAX_COMMENT_LENGTH + 1) },
          ],
        },
        null,
        2,
      )}\n`,
    )

    const { solves, notice } = store.loadSession('practice')

    expect(solves.map((each) => each.id)).toEqual([1])
    expect(notice).toMatch(/skipped 2 unreadable solve/)
  })

  it('accepts a comment right up to the shared limit', () => {
    store.scheduleSave('practice', [
      { ...solve(1), comment: 'x'.repeat(MAX_COMMENT_LENGTH) },
    ])
    store.flush()

    expect(store.loadSession('practice').notice).toBeNull()
  })
})

describe('store — deleting a session', () => {
  it('removes the file, the queued write and every trace of it', () => {
    store.scheduleSave('gone', [solve(1)])
    store.flush()
    store.scheduleSave('gone', [solve(1), solve(2)]) // queued, not yet written
    expect(filesInSessionsDir()).toContain('gone.json')

    store.deleteSessionFile('gone')

    expect(filesInSessionsDir()).not.toContain('gone.json')
    store.flush() // the queued write must not resurrect it
    expect(filesInSessionsDir()).not.toContain('gone.json')
    expect(store.loadSession('gone')).toEqual({ solves: [], notice: null })
  })

  it('is happy to delete a session that never had a file', () => {
    expect(() => store.deleteSessionFile('never-existed')).not.toThrow()
  })
})

describe('store — preferences', () => {
  it('starts from the defaults when no file exists', () => {
    const loaded = store.loadPreferences()
    expect(loaded.notice).toBeNull()
    expect(loaded.preferences).toEqual(DEFAULT_PREFERENCES)
  })

  it('round-trips every setting through prefs.json', () => {
    const prefs: Preferences = {
      holdThresholdMs: 550,
      inspection: false,
      inspectionSound: false,
      scrambleImage: false,
      mouseStart: true,
      colorScheme: 'dark',
    }

    store.savePreferences(prefs)
    const loaded = store.loadPreferences()

    expect(loaded.notice).toBeNull()
    expect(loaded.preferences).toEqual(prefs)
    expect(fs.readFileSync(store.preferencesPath(), 'utf8')).toContain('"version": 1')
    // Atomic, like everything else: the temp file is renamed, not left behind.
    expect(fs.readdirSync(path.dirname(store.preferencesPath())).some((n) => n.endsWith('.tmp'))).toBe(false)
  })

  it('quarantines an unparseable file and starts from the defaults', () => {
    fs.mkdirSync(path.dirname(store.preferencesPath()), { recursive: true })
    fs.writeFileSync(store.preferencesPath(), '{ not json', 'utf8')

    const loaded = store.loadPreferences()

    expect(loaded.preferences).toEqual(DEFAULT_PREFERENCES)
    expect(loaded.notice).toMatch(/not valid JSON.*moved to/)
    expect(fs.readdirSync(path.dirname(store.preferencesPath())).some((n) => n.startsWith('prefs.json.corrupt-'))).toBe(true)
  })

  it('quarantines a file of the wrong version rather than overwriting it', () => {
    fs.mkdirSync(path.dirname(store.preferencesPath()), { recursive: true })
    fs.writeFileSync(
      store.preferencesPath(),
      JSON.stringify({ version: 99, inspection: false }),
      'utf8',
    )

    const loaded = store.loadPreferences()

    expect(loaded.preferences).toEqual(DEFAULT_PREFERENCES)
    expect(loaded.notice).toMatch(/unrecognised format/)
  })

  it('validates fields individually, keeping the good ones', () => {
    fs.mkdirSync(path.dirname(store.preferencesPath()), { recursive: true })
    fs.writeFileSync(
      store.preferencesPath(),
      JSON.stringify({ version: 1, holdThresholdMs: 99_999, colorScheme: 'neon', inspection: false }),
      'utf8',
    )

    const loaded = store.loadPreferences()

    expect(loaded.notice).toBeNull()
    expect(loaded.preferences.holdThresholdMs).toBe(MAX_HOLD_THRESHOLD_MS) // clamped
    expect(loaded.preferences.colorScheme).toBe('system') // unknown → default
    expect(loaded.preferences.inspection).toBe(false) // good value kept
  })
})
