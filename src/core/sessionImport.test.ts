/*
 * sessionImport.test.ts — parsed csTimer sessions become one session each,
 * with the file's type attached before any listener reacts and names that the
 * library accepts.
 */
import { describe, expect, it, vi } from 'vitest'

import type { ImportedSession } from './csTimerFormat.js'
import { importIntoLibrary } from './sessionImport.js'
import type { Solve } from './session.js'
import { MAX_NAME_LENGTH, SessionLibrary } from './sessionLibrary.js'

const imported = (overrides: Partial<ImportedSession> = {}): ImportedSession => ({
  name: 'Weekly',
  scrambleType: '333',
  rank: 1,
  solves: [
    {
      timeMs: 12_345,
      scramble: "R U R'",
      createdAtMs: 1_700_000_000_000,
      penalty: 'plus2',
      comment: 'note',
    },
  ],
  ...overrides,
})

describe('importIntoLibrary', () => {
  it('creates one session per file session, in order, and activates the first', () => {
    const library = new SessionLibrary()
    const seeds: Array<{ id: string; count: number }> = []

    const summary = importIntoLibrary(
      library,
      [
        imported({ name: 'Weekly' }),
        imported({
          name: '4x4',
          scrambleType: '444wca',
          rank: 2,
          solves: [
            { timeMs: 60_000, scramble: 'Uw', createdAtMs: 1_700_000_100_000 },
            { timeMs: 61_000, scramble: 'Fw', createdAtMs: 1_700_000_200_000 },
          ],
        }),
      ],
      {
        onSession: (entry, solves) => seeds.push({ id: entry.id, count: solves.length }),
      },
    )

    expect(summary).toEqual({ sessionCount: 2, solveCount: 3, firstId: 'weekly' })
    expect(library.activeId).toBe('weekly')
    expect(library.entries.map((entry) => entry.name)).toEqual(['Default', 'Weekly', '4x4'])
    expect(library.find('weekly')?.scrambleType).toBe('333')
    expect(library.find('4x4')?.scrambleType).toBe('444wca')
    expect(seeds).toEqual([
      { id: 'weekly', count: 1 },
      { id: '4x4', count: 2 },
    ])
  })

  it('seeds the session before the library announces it', () => {
    const library = new SessionLibrary()
    const listener = vi.fn()
    library.subscribe(listener)
    let hooked = false

    importIntoLibrary(library, [imported()], {
      onSession: () => {
        expect(listener).not.toHaveBeenCalled()
        hooked = true
      },
    })

    expect(hooked).toBe(true)
    expect(listener).toHaveBeenCalled()
  })

  it('switches once, to the first created session', () => {
    const library = new SessionLibrary()
    const kinds: string[] = []
    library.subscribe((change) => kinds.push(change.kind))

    importIntoLibrary(
      library,
      [
        imported({ name: 'Weekly' }),
        imported({ name: '4x4', scrambleType: '444wca', rank: 2 }),
      ],
      { onSession: () => {} },
    )

    expect(kinds.filter((kind) => kind === 'switched')).toHaveLength(1)
    expect(library.activeId).toBe('weekly')
  })

  it('dedupes names with a suffix and caps them at the library limit', () => {
    const library = new SessionLibrary([{ id: 'default', name: 'Weekly' }])
    const long = 'n'.repeat(MAX_NAME_LENGTH + 20)

    importIntoLibrary(
      library,
      [imported({ name: 'Weekly' }), imported({ name: 'Weekly' }), imported({ name: long })],
      { onSession: () => {} },
    )

    const names = library.entries.map((entry) => entry.name)
    expect(names).toEqual([
      'Weekly',
      'Weekly (2)',
      'Weekly (3)',
      'n'.repeat(MAX_NAME_LENGTH),
    ])
  })

  it('copies the parsed solves with ids, type, penalty and comment', () => {
    const library = new SessionLibrary()
    let seen: readonly Solve[] = []

    importIntoLibrary(library, [imported()], {
      onSession: (_entry, solves) => {
        seen = solves
      },
    })

    expect(seen).toEqual([
      {
        id: 1,
        timeMs: 12_345,
        scramble: "R U R'",
        scrambleType: '333',
        createdAtMs: 1_700_000_000_000,
        penalty: 'plus2',
        comment: 'note',
      },
    ])
  })
})
