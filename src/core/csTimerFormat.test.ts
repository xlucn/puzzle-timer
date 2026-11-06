/*
 * csTimerFormat.test.ts — the file shape is the contract.
 *
 * A golden csTimer export is still wanted (PLAN.md §7); until it lands these
 * tests speak the format table in PLAN.md §5: penalty codes, raw milliseconds,
 * epoch seconds, the outer row's scramble/comment, and the properties object
 * csTimer needs for a complete restore.
 */
import { describe, expect, it } from 'vitest'

import {
  CsTimerFormatError,
  formatCsTimerData,
  parseCsTimerData,
  type ExportSession,
} from './csTimerFormat.js'
import { MAX_COMMENT_LENGTH } from './session.js'
import { MAX_NAME_LENGTH } from './sessionLibrary.js'
import { SCRAMBLE_DEFAULT_TYPE } from './scrambleTypes.js'
import type { Solve } from './session.js'

const solve = (overrides: Partial<Solve> = {}): Solve => ({
  id: 1,
  timeMs: 12_345,
  scramble: "R U R'",
  scrambleType: '333',
  createdAtMs: 1_700_000_000_000,
  ...overrides,
})

const sample = {
  session1: [
    [[0, 12_345], "R U R'", '', 1_700_000_000],
    [[2000, 10_000], 'F2 D', 'first try', 1_700_000_100],
    [[-1, 5_000], '', '', 1_700_000_200],
    [[0, 9_000, 3_000, 6_000], 'D', '', 1_700_000_300],
  ],
  session2: [],
  properties: {
    sessionN: 2,
    sessionData: JSON.stringify({
      1: { name: '  Weekly  ', opt: { scrType: '333' }, rank: 2 },
      2: { name: '4x4', opt: { scrType: '444wca', phases: [] }, rank: 1 },
    }),
  },
}

describe('parseCsTimerData', () => {
  it('maps penalties, milliseconds, dates, comments and ranks', () => {
    const { sessions, warnings } = parseCsTimerData(JSON.stringify(sample))

    expect(sessions.map((session) => session.name)).toEqual(['4x4', 'Weekly'])
    expect(sessions.map((session) => session.rank)).toEqual([1, 2])
    expect(sessions.map((session) => session.scrambleType)).toEqual(['444wca', '333'])
    expect(sessions[0].solves).toEqual([])

    const weekly = sessions[1].solves
    expect(weekly).toHaveLength(4)
    expect(weekly[0]).toMatchObject({
      timeMs: 12_345,
      scramble: "R U R'",
      createdAtMs: 1_700_000_000_000,
    })
    expect(weekly[1].penalty).toBe('plus2')
    expect(weekly[1].comment).toBe('first try')
    expect(weekly[2].penalty).toBe('dnf')
    expect(weekly[3].timeMs).toBe(9_000)
    expect(warnings.join('\n')).toMatch(/dropped 2 phase split/)
  })

  it('keeps a file usable when optional metadata is missing', () => {
    const { sessions, warnings } = parseCsTimerData(
      JSON.stringify({
        session1: [[[0, 1_000], 'U', '', 1_700_000_000]],
      }),
    )
    expect(sessions).toHaveLength(1)
    expect(sessions[0].name).toBe('Session 1')
    expect(sessions[0].scrambleType).toBe(SCRAMBLE_DEFAULT_TYPE)
    expect(sessions[0].rank).toBe(1)
    expect(warnings.join('\n')).toMatch(/properties is missing/)
  })

  it('falls back on an unknown scramble type instead of losing the session', () => {
    const { sessions, warnings } = parseCsTimerData(
      JSON.stringify({
        session1: [],
        properties: {
          sessionN: 1,
          sessionData: JSON.stringify({ 1: { name: 'Odd', opt: { scrType: 'no-such' } } }),
        },
      }),
    )
    expect(sessions[0].scrambleType).toBe(SCRAMBLE_DEFAULT_TYPE)
    expect(warnings.join('\n')).toMatch(/unknown scramble type/)
  })

  it('skips malformed rows and truncates comments and names', () => {
    const longComment = 'x'.repeat(MAX_COMMENT_LENGTH + 25)
    const longName = 'n'.repeat(MAX_NAME_LENGTH + 25)
    const { sessions, warnings } = parseCsTimerData(
      JSON.stringify({
        session1: [
          [[0, 1_000], 'U', longComment, 1_700_000_000],
          'not a row',
          [[0, 'soon'], 'U', '', 1_700_000_100],
          [[0, 2_000], 'U', '', 'yesterday'],
        ],
        properties: {
          sessionN: 1,
          sessionData: JSON.stringify({ 1: { name: longName } }),
        },
      }),
    )
    expect(sessions[0].name).toHaveLength(MAX_NAME_LENGTH)
    expect(sessions[0].solves).toHaveLength(1)
    expect(sessions[0].solves[0].comment).toHaveLength(MAX_COMMENT_LENGTH)
    expect(warnings.join('\n')).toMatch(/skipped 3 malformed solve/)
  })

  it('keeps a numeric session name and accepts a file without sessionN', () => {
    const { sessions, warnings } = parseCsTimerData(
      JSON.stringify({
        session1: [],
        properties: {
          sessionData: JSON.stringify({ 1: { name: 9, opt: { scrType: '333' } } }),
        },
      }),
    )
    expect(sessions[0].name).toBe('9')
    expect(warnings).toEqual([])
  })

  it('keeps rows csTimer exported without a date', () => {

    const { sessions, warnings } = parseCsTimerData(
      JSON.stringify({
        session1: [
          [[0, 1_000], 'U', ''], // older csTimer omits the date element
          [[0, 2_000], 'D', 'note'],
          [[0, 3_000], 'F', '', 1_700_000_000],
        ],
      }),
    )
    expect(sessions[0].solves.map((solve) => solve.createdAtMs)).toEqual([
      0,
      0,
      1_700_000_000_000,
    ])
    expect(sessions[0].solves[1].comment).toBe('note')
    expect(warnings.join('\n')).not.toMatch(/malformed/)
  })

  it('accepts a UTF-8 BOM before the JSON object', () => {

    const { sessions } = parseCsTimerData(
      `\uFEFF${JSON.stringify({ session1: [[[0, 1_000], 'U', '', 1_700_000_000]] })}`,
    )
    expect(sessions).toHaveLength(1)
  })

  it('reads the session keys, not a hand-edited sessionN', () => {
    const { sessions, warnings } = parseCsTimerData(
      JSON.stringify({
        session1: [],
        properties: { sessionN: 1_000_000_000, sessionData: '{}' },
      }),
    )
    expect(sessions).toHaveLength(1)
    expect(warnings.join('\n')).toMatch(/only 1 session list/)
  })

  it('warns about an unknown penalty instead of dropping the solve', () => {
    const { sessions, warnings } = parseCsTimerData(
      JSON.stringify({
        session1: [[[999, 1_500], 'U', '', 1_700_000_000]],
      }),
    )
    expect(sessions[0].solves).toHaveLength(1)
    expect(sessions[0].solves[0].penalty).toBeUndefined()
    expect(warnings.join('\n')).toMatch(/unknown penalty/)
  })

  it('throws only when the file is not a csTimer object at all', () => {
    expect(() => parseCsTimerData('not json')).toThrow(CsTimerFormatError)
    expect(() => parseCsTimerData('[]')).toThrow(CsTimerFormatError)
    expect(() => parseCsTimerData('{}')).toThrow(CsTimerFormatError)
  })
})

describe('formatCsTimerData', () => {
  const sessions: ExportSession[] = [
    {
      name: 'Weekly',
      scrambleType: '333',
      solves: [
        solve({ id: 1, timeMs: 12_345, createdAtMs: 1_700_000_000_000 }),
        solve({
          id: 2,
          timeMs: 9_000,
          penalty: 'plus2',
          comment: 'note',
          createdAtMs: 1_700_000_100_500,
        }),
        solve({ id: 3, timeMs: 5_000, penalty: 'dnf', createdAtMs: 1_700_000_200_000 }),
      ],
    },
    { name: '4x4', scrambleType: '444wca', solves: [] },
  ]

  it('writes the rows and the properties object csTimer restores from', () => {
    const data = JSON.parse(formatCsTimerData(sessions))

    expect(data.properties.sessionN).toBe(2)
    const meta = JSON.parse(data.properties.sessionData)
    expect(meta['1']).toEqual({
      name: 'Weekly',
      opt: { scrType: '333', phases: [] },
      rank: 1,
    })
    expect(meta['2']).toEqual({
      name: '4x4',
      opt: { scrType: '444wca', phases: [] },
      rank: 2,
    })

    expect(data.session1).toEqual([
      [[0, 12_345], "R U R'", '', 1_700_000_000],
      [[2000, 9_000], "R U R'", 'note', 1_700_000_100],
      [[-1, 5_000], "R U R'", '', 1_700_000_200],
    ])
    expect(data.session2).toEqual([])
  })

  it('round-trips through the parser', () => {
    const { sessions: parsed, warnings } = parseCsTimerData(formatCsTimerData(sessions))
    expect(warnings).toEqual([])
    expect(parsed).toHaveLength(2)
    expect(parsed[0].name).toBe('Weekly')
    expect(parsed[0].scrambleType).toBe('333')
    expect(parsed[0].solves).toEqual([
      { timeMs: 12_345, scramble: "R U R'", createdAtMs: 1_700_000_000_000 },
      {
        timeMs: 9_000,
        scramble: "R U R'",
        comment: 'note',
        createdAtMs: 1_700_000_100_000,
        penalty: 'plus2',
      },
      {
        timeMs: 5_000,
        scramble: "R U R'",
        createdAtMs: 1_700_000_200_000,
        penalty: 'dnf',
      },
    ])
  })

  it('derives the session type from the newest solve and has fallbacks', () => {
    const data = JSON.parse(
      formatCsTimerData([
        {
          name: '',
          solves: [
            solve({ id: 1, scrambleType: '333' }),
            solve({ id: 2, scrambleType: '444m' }),
          ],
        },
      ]),
    )
    const meta = JSON.parse(data.properties.sessionData)
    expect(meta['1'].name).toBe('Session 1')
    expect(meta['1'].opt.scrType).toBe('444m')
  })

  it('ignores a session type the catalogue does not know', () => {
    const data = JSON.parse(
      formatCsTimerData([
        { name: 'Odd', scrambleType: 'no-such', solves: [solve({ scrambleType: '333' })] },
        { name: 'Empty', scrambleType: 'no-such', solves: [] },
      ]),
    )
    const meta = JSON.parse(data.properties.sessionData)
    expect(meta['1'].opt.scrType).toBe('333')
    expect(meta['2'].opt.scrType).toBe(SCRAMBLE_DEFAULT_TYPE)
  })
})
