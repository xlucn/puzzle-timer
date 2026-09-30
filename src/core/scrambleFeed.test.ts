import { describe, expect, it, vi } from 'vitest'

import { ScrambleFeed } from './scrambleFeed.js'

/** A promise whose resolution the test controls, so ordering is explicit. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Flush the microtasks a settled generation promise runs on. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * A `generate` the test drives by hand: records every call, hands back a
 * promise it settles later.
 */
function fakeGenerator() {
  const calls: { type: string; deferred: ReturnType<typeof deferred<string>> }[] = []
  const generate = vi.fn((type: string) => {
    const d = deferred<string>()
    calls.push({ type, deferred: d })
    return d.promise
  })
  return { generate, calls }
}

function feedWith(generator: ReturnType<typeof fakeGenerator>, type = '333') {
  const feed = new ScrambleFeed({ type, generate: generator.generate })
  return feed
}

describe('ScrambleFeed', () => {
  it('generates the first scramble, then keeps one warm', async () => {
    const generator = fakeGenerator()
    const feed = feedWith(generator)

    expect(feed.state).toEqual({ type: '333', scramble: null, error: null })

    feed.start()
    expect(feed.state.scramble).toBeNull() // nothing to show while it generates
    expect(generator.calls).toHaveLength(1)

    generator.calls[0].deferred.resolve('scramble A')
    await flush()

    expect(feed.state.scramble).toBe('scramble A')
    expect(feed.state.error).toBeNull()
    expect(generator.calls.map((call) => call.type)).toEqual(['333', '333']) // current + warm

    generator.calls[1].deferred.resolve('scramble B')
    await flush()
    expect(feed.state.scramble).toBe('scramble A') // warm stays out of sight
  })

  it('start() is a no-op once a scramble is under way or displayed', async () => {
    const generator = fakeGenerator()
    const feed = feedWith(generator)

    feed.start()
    feed.start()
    expect(generator.calls).toHaveLength(1)

    generator.calls[0].deferred.resolve('scramble A')
    await flush()
    feed.start()
    await flush()
    expect(generator.calls).toHaveLength(2) // only the warm-up, no third
  })

  it('advance() swaps in the warm scramble without generating again', async () => {
    const generator = fakeGenerator()
    const feed = feedWith(generator)

    feed.start()
    generator.calls[0].deferred.resolve('scramble A')
    await flush()
    generator.calls[1].deferred.resolve('scramble B')
    await flush()

    feed.advance()
    expect(feed.state.scramble).toBe('scramble B')
    expect(generator.calls).toHaveLength(3) // B shown → C warmed

    generator.calls[2].deferred.resolve('scramble C')
    await flush()
    expect(feed.state.scramble).toBe('scramble B')
  })

  it('advance() during warm-up keeps that generation instead of duplicating it', async () => {
    const generator = fakeGenerator()
    const feed = feedWith(generator)

    feed.start()
    generator.calls[0].deferred.resolve('scramble A')
    await flush()
    expect(generator.calls).toHaveLength(2) // warm in flight

    feed.advance() // solve finished before the warm scramble was ready
    expect(feed.state.scramble).toBeNull()
    expect(generator.calls).toHaveLength(2) // not thrown away, not duplicated

    generator.calls[1].deferred.resolve('scramble B')
    await flush()
    expect(feed.state.scramble).toBe('scramble B')
    expect(generator.calls).toHaveLength(3) // only now does a new warm-up start

    generator.calls[1].deferred.resolve('scramble B') // settling twice is harmless
    await flush()
    expect(feed.state.scramble).toBe('scramble B')
  })

  it('setType() drops a result generated for the previous type', async () => {
    const generator = fakeGenerator()
    const feed = feedWith(generator)

    feed.start() // generating a 3x3 scramble
    feed.setType('444wca')
    expect(feed.state.type).toBe('444wca')
    expect(feed.state.scramble).toBeNull()

    const old = generator.calls[0]
    old.deferred.resolve('stale 3x3 scramble')
    await flush()
    expect(feed.state.scramble).toBeNull() // discarded, not displayed

    generator.calls[1].deferred.resolve('4x4 scramble')
    await flush()
    expect(feed.state.scramble).toBe('4x4 scramble')
    expect(generator.calls.map((call) => call.type)).toEqual(['333', '444wca', '444wca'])
  })

  it('setType() to the type already selected does nothing', async () => {
    const generator = fakeGenerator()
    const feed = feedWith(generator)

    feed.start()
    feed.setType('333')
    expect(generator.calls).toHaveLength(1)
  })

  it('refresh() replaces the displayed scramble and the warm one', async () => {
    const generator = fakeGenerator()
    const feed = feedWith(generator)

    feed.start()
    generator.calls[0].deferred.resolve('scramble A')
    await flush()
    generator.calls[1].deferred.resolve('scramble B')
    await flush()

    feed.refresh()
    expect(feed.state.scramble).toBeNull()

    generator.calls[2].deferred.resolve('scramble C')
    await flush()
    expect(feed.state.scramble).toBe('scramble C')
    expect(generator.calls).toHaveLength(4) // and a fresh warm-up
  })

  it('reports a failed current scramble and retries on refresh()', async () => {
    const generator = fakeGenerator()
    const feed = feedWith(generator)

    feed.start()
    generator.calls[0].deferred.reject(new Error('subscript out of range'))
    await flush()

    expect(feed.state.scramble).toBeNull()
    expect(feed.state.error).toBe('subscript out of range')

    feed.refresh() // the user asks for another try
    expect(feed.state.error).toBeNull() // showing the attempt, not the old failure
    generator.calls[1].deferred.resolve('scramble A')
    await flush()
    expect(feed.state.scramble).toBe('scramble A')
    expect(feed.state.error).toBeNull()
  })

  it('keeps showing the current scramble when only the warm one fails', async () => {
    const generator = fakeGenerator()
    const feed = feedWith(generator)

    feed.start()
    generator.calls[0].deferred.resolve('scramble A')
    await flush()
    generator.calls[1].deferred.reject(new Error('boom'))
    await flush()

    expect(feed.state.scramble).toBe('scramble A') // still solvable
    expect(feed.state.error).toBe('boom')

    feed.advance() // no warm scramble → back to an error state, one retry
    expect(feed.state.scramble).toBeNull()
    expect(feed.state.error).toBeNull()

    generator.calls[2].deferred.reject(new Error('boom again'))
    await flush()
    expect(feed.state.error).toBe('boom again')
  })

  it('treats an empty scramble as a failure', async () => {
    const generator = fakeGenerator()
    const feed = feedWith(generator)

    feed.start()
    generator.calls[0].deferred.resolve('')
    await flush()

    expect(feed.state.scramble).toBeNull()
    expect(feed.state.error).toBe('the scrambler returned an empty scramble')
  })

  it('survives a generator that throws synchronously', async () => {
    const feed = new ScrambleFeed({
      type: '333',
      generate: () => {
        throw new Error('worker not running')
      },
    })

    feed.start()
    await flush()
    expect(feed.state.error).toBe('worker not running')
  })

  it('announces exactly the visible changes, and stops after unsubscribe', async () => {
    const generator = fakeGenerator()
    const feed = feedWith(generator)
    const seen: (string | null)[] = []
    const unsubscribe = feed.subscribe((state) => seen.push(state.scramble))

    feed.start() // nothing visible yet, but the "generating" state is announced
    generator.calls[0].deferred.resolve('scramble A')
    await flush() // lands, then quietly starts warming the next one
    expect(seen).toEqual([null, 'scramble A'])

    feed.advance() // warm still in flight → promoted, shown as generating again
    expect(seen).toEqual([null, 'scramble A', null])

    unsubscribe()
    generator.calls[1].deferred.resolve('scramble B')
    await flush()
    expect(seen).toEqual([null, 'scramble A', null]) // no more events
  })
})
