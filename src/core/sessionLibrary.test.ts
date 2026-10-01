import { describe, expect, it, vi } from 'vitest'

import { MAX_NAME_LENGTH, SessionLibrary, type SessionEntry } from './sessionLibrary.js'

const entry = (id: string, name: string): SessionEntry => ({ id, name })

const one = (name = 'Default') => new SessionLibrary([{ id: 'default', name }])

describe('SessionLibrary — construction', () => {
  it('never comes up empty: a fresh install gets a Default session', () => {
    const library = new SessionLibrary()
    expect(library.entries).toEqual([entry('default', 'Default')])
    expect(library.active).toEqual(entry('default', 'Default'))
  })

  it('honours the entries and the active id from the index', () => {
    const library = new SessionLibrary(
      [entry('default', 'Default'), entry('meet-weekly', 'Meet weekly')],
      'meet-weekly',
    )
    expect(library.activeId).toBe('meet-weekly')
    expect(library.entries).toHaveLength(2)
  })

  it('falls back to the first entry when the stored active id is gone', () => {
    const library = new SessionLibrary([entry('default', 'Default')], 'deleted-session')
    expect(library.activeId).toBe('default')
    expect(new SessionLibrary([], 'anything').activeId).toBe('default')
  })
})

describe('SessionLibrary — per-session scramble type', () => {
  it('stores a type on a session, announcing the change exactly once', () => {
    const library = one()
    const listener = vi.fn()
    library.subscribe(listener)

    expect(library.setScrambleType('default', '444wca')).toBe(true)
    expect(library.find('default')?.scrambleType).toBe('444wca')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0]).toEqual({
      kind: 'retyped',
      entry: { id: 'default', name: 'Default', scrambleType: '444wca' },
    })

    // No event when nothing changed, and nothing for unknown ids.
    expect(library.setScrambleType('default', '444wca')).toBe(false)
    expect(library.setScrambleType('gone', '333')).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('leaves a session without a type undefined — the default applies', () => {
    const library = one()
    expect(library.find('default')?.scrambleType).toBeUndefined()
    expect(library.entries).toEqual([entry('default', 'Default')])
  })

  it('a new session inherits the type you are solving', () => {
    const library = one()
    library.setScrambleType('default', '444wca')
    expect(library.create('4x4 practice')?.scrambleType).toBe('444wca')

    // A session created from a typeless one stays typeless.
    const fresh = new SessionLibrary([{ id: 'a', name: 'A' }], 'a')
    expect(fresh.create('B')?.scrambleType).toBeUndefined()
  })
})

describe('SessionLibrary — create', () => {
  it('adds a session, makes it active and announces both steps', () => {
    const library = one()
    const listener = vi.fn()
    library.subscribe(listener)

    const created = library.create('  Meet weekly  ')

    expect(created).toEqual(entry('meet-weekly', 'Meet weekly'))
    expect(library.activeId).toBe('meet-weekly')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls[0][0]).toEqual({ kind: 'created', entry: created })
    expect(listener.mock.calls[1][0]).toEqual({
      kind: 'switched',
      id: 'meet-weekly',
      previousId: 'default',
    })
  })

  it('derives a file id from the name, folding accents', () => {
    const library = one()
    expect(library.create('Café practice')?.id).toBe('cafe-practice')
  })

  it('falls back for names with no latin letters and still stays unique', () => {
    const library = one()
    expect(library.create('三盲')?.id).toBe('session')
    expect(library.create('練習')?.id).toBe('session-2')
  })

  it('suffixes a colliding id rather than reusing one', () => {
    const library = one()
    library.create('Meet weekly')
    library.create('Meet Weekly!') // slugifies to 'meet-weekly' as well
    expect(library.entries.map((each) => each.id)).toEqual([
      'default',
      'meet-weekly',
      'meet-weekly-2',
    ])
  })

  it('refuses names the dialog would have blocked, emitting nothing', () => {
    const library = one()
    const listener = vi.fn()
    library.subscribe(listener)

    expect(library.create('   ')).toBeNull()
    expect(library.create('x'.repeat(MAX_NAME_LENGTH + 1))).toBeNull()
    expect(library.create('default')).toBeNull() // case-insensitive duplicate
    expect(library.create('DEFAULT ')).toBeNull()
    expect(library.entries).toHaveLength(1)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('SessionLibrary — nameError', () => {
  it('reports why a name is unusable', () => {
    const library = new SessionLibrary([entry('default', 'Meet weekly')])
    expect(library.nameError('  ')).toBe('empty')
    expect(library.nameError('x'.repeat(MAX_NAME_LENGTH + 1))).toBe('long')
    expect(library.nameError('meet WEEKLY')).toBe('duplicate')
    expect(library.nameError('Something else')).toBeNull()
  })

  it('lets a session keep its own name when renaming', () => {
    const library = new SessionLibrary([entry('default', 'Meet weekly')])
    expect(library.nameError('Meet weekly', 'default')).toBeNull()
    expect(library.nameError('Meet weekly', 'other')).toBe('duplicate')
  })
})

describe('SessionLibrary — rename', () => {
  it('changes the display name and keeps the id (so the file)', () => {
    const library = one()
    const listener = vi.fn()
    library.subscribe(listener)

    expect(library.rename('default', '  Practice  ')).toBe(true)

    expect(library.entries).toEqual([entry('default', 'Practice')])
    expect(listener).toHaveBeenCalledWith({ kind: 'renamed', entry: entry('default', 'Practice') })
    expect(library.activeId).toBe('default')
  })

  it('does not hand out a shared object to its caller', () => {
    const source = [entry('default', 'Default')]
    const library = new SessionLibrary(source)
    library.rename('default', 'Renamed')
    expect(source[0].name).toBe('Default') // the loader's array stays as it read it
    expect(library.active.name).toBe('Renamed')
  })

  it('refuses a duplicate name, a blank one, or an unknown id', () => {
    const library = new SessionLibrary([entry('default', 'Default'), entry('b', 'Practice')])
    expect(library.rename('b', 'default')).toBe(false)
    expect(library.rename('b', '   ')).toBe(false)
    expect(library.rename('nope', 'Fine')).toBe(false)
    expect(library.entries).toEqual([entry('default', 'Default'), entry('b', 'Practice')])
  })

  it('accepts a rename to its own current name', () => {
    const library = new SessionLibrary([entry('default', 'Default')])
    expect(library.rename('default', 'Default ')).toBe(true)
    expect(library.active.name).toBe('Default')
  })
})

describe('SessionLibrary — remove', () => {
  it('refuses to delete the last session', () => {
    const library = one()
    const listener = vi.fn()
    library.subscribe(listener)

    expect(library.remove('default')).toBe(false)
    expect(library.entries).toHaveLength(1)
    expect(listener).not.toHaveBeenCalled()
  })

  it('refuses an unknown id', () => {
    expect(one().remove('nope')).toBe(false)
  })

  it('moves the active flag to the next session', () => {
    const library = new SessionLibrary(
      [entry('a', 'A'), entry('b', 'B'), entry('c', 'C')],
      'b',
    )
    const listener = vi.fn()
    library.subscribe(listener)

    expect(library.remove('b')).toBe(true)
    expect(library.activeId).toBe('c') // the entry that slid into b's slot
    expect(listener.mock.calls.map((call) => call[0].kind)).toEqual(['deleted', 'switched'])
    expect(listener.mock.calls[1][0]).toEqual({ kind: 'switched', id: 'c', previousId: 'b' })
  })

  it('falls back to the previous session when the active one was last', () => {
    const library = new SessionLibrary([entry('a', 'A'), entry('b', 'B')], 'b')
    library.remove('b')
    expect(library.activeId).toBe('a')
  })

  it('leaves the active session alone when another one is deleted', () => {
    const library = new SessionLibrary([entry('a', 'A'), entry('b', 'B')], 'a')
    const listener = vi.fn()
    library.subscribe(listener)

    library.remove('b')

    expect(library.activeId).toBe('a')
    expect(listener.mock.calls.map((call) => call[0].kind)).toEqual(['deleted'])
  })
})

describe('SessionLibrary — switchTo', () => {
  it('switches and announces old → new', () => {
    const library = new SessionLibrary([entry('a', 'A'), entry('b', 'B')])
    const listener = vi.fn()
    library.subscribe(listener)

    expect(library.switchTo('b')).toBe(true)
    expect(listener).toHaveBeenCalledWith({ kind: 'switched', id: 'b', previousId: 'a' })
  })

  it('does nothing for an unknown id or the session already active', () => {
    const library = one()
    const listener = vi.fn()
    library.subscribe(listener)

    expect(library.switchTo('nope')).toBe(false)
    expect(library.switchTo('default')).toBe(false)
    expect(library.activeId).toBe('default')
    expect(listener).not.toHaveBeenCalled()
  })

  it('stops announcing after unsubscribe', () => {
    const library = new SessionLibrary([entry('a', 'A'), entry('b', 'B')])
    const listener = vi.fn()
    library.subscribe(listener)()
    library.switchTo('b')
    expect(listener).not.toHaveBeenCalled()
  })
})
