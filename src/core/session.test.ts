import { describe, expect, it, vi } from 'vitest'

import { Session, type Solve } from './session.js'

/** A stored solve, as the file loader would hand it over. */
const stored = (id: number, over: Partial<Solve> = {}): Solve => ({
  id,
  timeMs: 1000 * id,
  scramble: `scramble ${id}`,
  scrambleType: '333',
  createdAtMs: 1_700_000_000_000 + id,
  ...over,
})

/** What the timer hands to `add()` — no id yet. */
const fresh = (timeMs: number) => ({
  timeMs,
  scramble: "R U R' U'",
  scrambleType: '333',
  createdAtMs: 1_700_000_000_000,
})

const ids = (session: Session) => session.solves.map((solve) => solve.id)

describe('Session — recording', () => {
  it('appends solves in order and numbers them from 1', () => {
    const session = new Session()
    expect(session.size).toBe(0)

    const first = session.add(fresh(12_345))
    const second = session.add(fresh(9_876))

    expect([first.id, second.id]).toEqual([1, 2])
    expect(ids(session)).toEqual([1, 2])
    expect(second.timeMs).toBe(9_876) // the timer's measurement survives intact
  })

  it('announces every addition with its position', () => {
    const session = new Session()
    const listener = vi.fn()
    session.subscribe(listener)

    session.add(fresh(1_000))
    session.add(fresh(2_000))

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls[0][0]).toMatchObject({ kind: 'added', position: 0 })
    expect(listener.mock.calls[1][0]).toMatchObject({ kind: 'added', position: 1 })
    expect(listener.mock.calls[1][0].solve.id).toBe(2)
  })

  it('continues numbering above the ids loaded from disk', () => {
    const session = new Session([stored(4), stored(9)])
    expect(session.add(fresh(1_000)).id).toBe(10)
  })

  it('copies the array it is constructed from', () => {
    const fromFile = [stored(1)]
    const session = new Session(fromFile)
    session.add(fresh(1_000))
    expect(fromFile).toHaveLength(1) // the loader's array is not our storage
  })

  it('finds solves by id', () => {
    const session = new Session([stored(1), stored(2)])
    expect(session.find(2)?.timeMs).toBe(2_000)
    expect(session.find(99)).toBeUndefined()
    expect(session.indexOf(1)).toBe(0)
    expect(session.indexOf(99)).toBe(-1)
  })
})

describe('Session — delete', () => {
  it('removes a solve and reports where it was', () => {
    const session = new Session([stored(1), stored(2), stored(3)])
    const listener = vi.fn()
    session.subscribe(listener)

    const removed = session.remove(2)

    expect(removed).toEqual({ solve: stored(2), position: 1 })
    expect(ids(session)).toEqual([1, 3])
    expect(listener).toHaveBeenCalledWith({ kind: 'removed', removed })
  })

  it('refuses to remove a solve it does not have', () => {
    const session = new Session([stored(1)])
    expect(session.remove(7)).toBeNull()
    expect(ids(session)).toEqual([1])
  })

  it('does not reuse an id after a deletion', () => {
    const session = new Session()
    const added = session.add(fresh(1_000))
    session.remove(added.id)
    expect(session.add(fresh(2_000)).id).toBe(2)
  })
})

describe('Session — restore (the undo toast)', () => {
  it('puts a deleted solve back exactly where it was', () => {
    const session = new Session([stored(1), stored(2), stored(3)])
    const removed = session.remove(2)!
    const listener = vi.fn()
    session.subscribe(listener)

    expect(session.restore(removed)).toEqual(stored(2))
    expect(ids(session)).toEqual([1, 2, 3])
    expect(listener).toHaveBeenCalledWith({ kind: 'restored', solve: stored(2), position: 1 })
  })

  it('restores the newest solve at the end again', () => {
    const session = new Session([stored(1), stored(2)])
    const removed = session.remove(2)!
    session.restore(removed)
    expect(ids(session)).toEqual([1, 2])
  })

  it('clamps to the end when later solves were deleted too', () => {
    const session = new Session([stored(1), stored(2), stored(3)])
    const last = session.remove(3)! // had position 2
    session.remove(1) // the list is now just #2, so position 2 no longer exists
    session.restore(last)
    expect(ids(session)).toEqual([2, 3]) // appended, not spliced past the end
  })

  it('is idempotent — a toast can outlive the row it belongs to', () => {
    const session = new Session([stored(1)])
    const removed = session.remove(1)!
    expect(session.restore(removed)).toEqual(stored(1))
    expect(session.restore(removed)).toBeNull()
    expect(ids(session)).toEqual([1])
  })

  it('keeps numbering above a restored id from another session', () => {
    const session = new Session()
    session.restore({ solve: stored(42), position: 0 })
    expect(ids(session)).toEqual([42])
    expect(session.add(fresh(1_000)).id).toBe(43)
  })

  it('round-trips a delete → restore cycle', () => {
    const session = new Session([stored(1), stored(2), stored(3)])
    const removed = session.remove(3)!
    session.restore(removed)
    expect(session.solves).toEqual([stored(1), stored(2), stored(3)])
    expect(session.add(fresh(4_000)).id).toBe(4)
  })
})

describe('Session — penalties', () => {
  it('sets a penalty and reports it with the solve position', () => {
    const session = new Session([stored(1), stored(2)])
    const listener = vi.fn()
    session.subscribe(listener)

    const solve = session.setPenalty(2, 'plus2')

    expect(solve?.penalty).toBe('plus2')
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'penalty', position: 1, solve }),
    )
  })

  it('replaces one penalty with another', () => {
    const session = new Session([stored(1)])
    session.setPenalty(1, 'plus2')
    session.setPenalty(1, 'dnf')
    expect(session.find(1)?.penalty).toBe('dnf')
  })

  it('clears back to OK with undefined', () => {
    const session = new Session([stored(1)])
    session.setPenalty(1, 'dnf')
    session.setPenalty(1, undefined)
    expect(session.find(1)?.penalty).toBeUndefined()
  })

  it('emits nothing when the penalty does not actually change', () => {
    const session = new Session([stored(1)])
    const listener = vi.fn()
    session.subscribe(listener)

    session.setPenalty(1, 'plus2')
    session.setPenalty(1, 'plus2') // no-op

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('refuses to touch a solve it does not have', () => {
    const session = new Session([stored(1)])
    expect(session.setPenalty(99, 'dnf')).toBeNull()
    expect(session.setPenalty(99, undefined)).toBeNull()
  })

  it('stores a penalty that arrives with the solve itself (inspection)', () => {
    const session = new Session([stored(1)])

    const solve = session.add({
      timeMs: 4_790,
      scramble: "R U R'",
      scrambleType: '333',
      createdAtMs: 1_700_000_000_000,
      penalty: 'dnf',
    })

    expect(solve.id).toBe(2)
    expect(solve.penalty).toBe('dnf')
    expect(session.find(2)?.penalty).toBe('dnf')

    // OK is still "absent" — no penalty key gets written for a clean solve.
    const clean = session.add({
      timeMs: 5_010,
      scramble: "U2 F'",
      scrambleType: '333',
      createdAtMs: 1_700_000_001_000,
    })
    expect('penalty' in clean).toBe(false)
  })
})

describe('Session — comments', () => {
  it('sets a comment and reports it with the solve position', () => {
    const session = new Session([stored(1)])
    const listener = vi.fn()
    session.subscribe(listener)

    const solve = session.setComment(1, 'lockup on the last alg')

    expect(solve?.comment).toBe('lockup on the last alg')
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'comment', position: 0, solve }),
    )
  })

  it('replaces and clears a comment', () => {
    const session = new Session([stored(1)])
    session.setComment(1, 'first note')
    session.setComment(1, 'second note')
    expect(session.find(1)?.comment).toBe('second note')

    session.setComment(1, undefined)
    expect(session.find(1)?.comment).toBeUndefined()
  })

  it('treats an empty comment as no comment', () => {
    const session = new Session([stored(1)])
    session.setComment(1, '')
    expect(session.find(1)?.comment).toBeUndefined()
    expect('comment' in session.find(1)!).toBe(false)
  })

  it('emits nothing when the comment does not actually change', () => {
    const session = new Session([stored(1)])
    const listener = vi.fn()
    session.subscribe(listener)

    session.setComment(1, 'note')
    session.setComment(1, 'note') // no-op

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('refuses to touch a solve it does not have', () => {
    const session = new Session([stored(1)])
    expect(session.setComment(99, 'note')).toBeNull()
  })
})
