/*
 * worker.ts — the thread that runs cstimer_module.
 *
 * Why it exists (AGENTS.md rule 4): a 4x4 WCA scramble takes ~1.2 s (measured
 * in PLAN.md §5) and ~1.2 s for a few other types too. Running that here
 * keeps the main thread free, so the timer keeps ticking and keys keep
 * landing while a scramble is being built.
 *
 * The protocol is deliberately tiny (see protocol.ts): every request gets
 * exactly one reply, and a scrambler that throws is reported as a failed
 * reply instead of killing the thread — some of the 206 types do throw.
 *
 * Run with `node --import tsx`, which resolves this file's imports the same
 * way it does for the main thread (see src/scramble/service.ts).
 */
import { parentPort } from 'node:worker_threads'

import cstimer from 'cstimer_module'

import { applyCsTimerLangStrings } from './cstimerLang.js'
import type { ScrambleRequest, ScrambleResponse } from './protocol.js'

applyCsTimerLangStrings()

const port = parentPort
if (port === null) {
  throw new Error('src/scramble/worker.ts must be started as a worker thread')
}

function handle(request: ScrambleRequest): ScrambleResponse {
  try {
    switch (request.cmd) {
      case 'scramble': {
        const scramble = cstimer.getScramble(request.type, request.length)
        if (!request.withImage) return { id: request.id, ok: true, value: scramble }
        return {
          id: request.id,
          ok: true,
          value: { scramble, image: imageOf(scramble, request.type) },
        }
      }
      case 'image':
        return { id: request.id, ok: true, value: imageOf(request.scramble, request.type) }
      case 'seed':
        cstimer.setSeed(request.seed)
        return { id: request.id, ok: true, value: null }
      default:
        return { id: (request as ScrambleRequest).id, ok: false, error: 'unknown command' }
    }
  } catch (error) {
    return {
      id: (request as ScrambleRequest).id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * The scramble's SVG, or null when its type has no drawing rule.
 * cstimer_module answers `false` (not a string, not an exception) for the 29
 * of 206 types without an image — verified for all 206 by
 * `tools/scramble_probe.ts`, which asserts this exact contract: an SVG string
 * (starts with `<`) or a falsey answer. Anything else is treated as "no
 * image": a missing picture must never fail the scramble that came with it.
 */
function imageOf(scramble: string, type: string): string | null {
  try {
    const image: unknown = cstimer.getImage(scramble, type)
    return typeof image === 'string' && image.startsWith('<') ? image : null
  } catch {
    return null
  }
}

// The worker only ever answers; cstimer_module's own onmessage (a browser
// worker shim it installs on `self`) is never dispatched here.
port.on('message', (request: ScrambleRequest) => {
  port.postMessage(handle(request))
})
