/*
 * service.ts — the main thread's door to the scramble worker.
 *
 * Everything here is Node-only (worker_threads), which is where AGENTS.md
 * says it belongs: src/core/ stays pure, and the UI only ever sees promises.
 *
 * Robustness rules, because a stuck scrambler must not mean a stuck app:
 *   - one worker, spawned on first use and re-spawned after it dies;
 *   - every request has a deadline — an over-slow type is killed and the
 *     caller gets an error the UI can show instead of a permanent spinner;
 *   - a worker that crashes rejects everything in flight rather than
 *     leaving promises pending forever.
 */
import { Worker } from 'node:worker_threads'

import { randomSeed } from '../platform/random.js'

import type { ScramblePayload, ScrambleRequest, ScrambleResponse } from './protocol.js'

/**
 * Longest we wait for a scramble. The slowest type measured is ~1.8 s
 * (444bld), and its image rides in the same round trip (~1 ms), so this is
 * generous; it exists for the pathological case.
 */
const DEFAULT_TIMEOUT_MS = 15_000

export interface ScrambleServiceOptions {
  /** Per-request deadline in milliseconds (default 15 s). */
  timeoutMs?: number
}

export interface ScrambleService {
  /** Generate one scramble. Rejects if the worker fails, stalls or throws. */
  scramble(type: string, length: number): Promise<string>
  /**
   * Generate one scramble *and* its SVG image in a single round trip: the
   * panel needs both at the same instant, and a request that lands after the
   * text would move the timer after it had settled.
   */
  scrambleWithImage(type: string, length: number): Promise<ScramblePayload>
  /** SVG of an already-generated scramble; null when its type has none. */
  image(scramble: string, type: string): Promise<string | null>
  /** Stop the worker and fail everything in flight. Idempotent. */
  dispose(): void
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Under `node --import tsx` (development, and how the app is run today) the
 * worker is a .ts file; after `tsc` the build is .js in dist/.
 */
const workerUrl = () =>
  new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url)

export function createScrambleService(options: ScrambleServiceOptions = {}): ScrambleService {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let worker: Worker | null = null
  let nextId = 1
  let disposed = false
  const pending = new Map<number, Pending>()

  /** Reject everything outstanding; optionally kill the worker too. */
  const failAll = (reason: Error, killWorker: boolean) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(reason)
    }
    pending.clear()

    if (killWorker && worker !== null) {
      const dying = worker
      worker = null
      void dying.terminate()
    }
  }

  const onMessage = (response: ScrambleResponse) => {
    const entry = pending.get(response.id)
    if (entry === undefined) return // already timed out, or a fire-and-forget seed
    pending.delete(response.id)
    clearTimeout(entry.timer)

    if (response.ok) entry.resolve(response.value)
    else entry.reject(new Error(response.error))
  }

  const ensureWorker = (): Worker => {
    if (worker !== null) return worker

    const spawned = new Worker(workerUrl())
    // Never hold the process open by itself; main.ts disposes us on quit.
    spawned.unref()
    spawned.on('message', onMessage)
    // Both handlers ignore a worker we already gave up on: its in-flight
    // requests were rejected at that point, and the replacement is ours now.
    spawned.on('error', (error: Error) => {
      if (worker === spawned) failAll(error, true)
    })
    spawned.on('exit', (code: number) => {
      if (worker !== spawned) return
      worker = null
      failAll(new Error(`scramble worker exited (code ${code})`), false)
    })
    worker = spawned

    // First message in: whatever the scrambler does next derives from this.
    spawned.postMessage({ id: 0, cmd: 'seed', seed: randomSeed() } satisfies ScrambleRequest)
    return spawned
  }

  const request = (message: (id: number) => ScrambleRequest): Promise<unknown> => {
    if (disposed) return Promise.reject(new Error('scramble service is disposed'))

    const id = nextId++
    const target = ensureWorker()

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`scramble not ready after ${timeoutMs} ms`))
        // The worker is wedged inside a scrambler: put it down and let the
        // next request spawn a fresh one.
        failAll(new Error(`scramble worker timed out after ${timeoutMs} ms`), true)
      }, timeoutMs)

      pending.set(id, { resolve, reject, timer })
      target.postMessage(message(id))
    })
  }

  return {
    scramble(type: string, length: number): Promise<string> {
      return request((id) => ({ id, cmd: 'scramble', type, length, withImage: false })).then(
        (value) => {
          if (typeof value !== 'string') {
            throw new Error('scramble worker returned no scramble')
          }
          return value
        },
      )
    },

    scrambleWithImage(type: string, length: number): Promise<ScramblePayload> {
      return request((id) => ({ id, cmd: 'scramble', type, length, withImage: true })).then(
        (value) => {
          const payload = value as ScramblePayload | null
          if (payload === null || typeof payload.scramble !== 'string') {
            throw new Error('scramble worker returned no scramble')
          }
          return payload
        },
      )
    },

    image(scramble: string, type: string): Promise<string | null> {
      return request((id) => ({ id, cmd: 'image', scramble, type })).then((value) =>
        typeof value === 'string' && value.length > 0 ? value : null,
      )
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      failAll(new Error('scramble service was disposed'), true)
    },
  }
}
