/*
 * protocol.ts — messages exchanged with the scramble worker.
 *
 * Plain data only: it's structured-cloned across the thread boundary, so no
 * functions, no class instances, no `gi:*`.
 *
 * A scramble can carry its SVG image: the image is produced in the same
 * round trip as the text (one request, one reply), so the panel can put both
 * on screen at the same instant — a separate image request would land a frame
 * or two later and move the timer *after* the scramble had settled.
 */

/** One scramble as the worker returns it. */
export interface ScramblePayload {
  scramble: string
  /** SVG source of the scramble, or null when its type has no image. */
  image: string | null
}

/** Main thread → worker. `id` is echoed back in the reply. */
export type ScrambleRequest =
  | { id: number; cmd: 'scramble'; type: string; length: number; withImage: boolean }
  | { id: number; cmd: 'image'; scramble: string; type: string }
  | { id: number; cmd: 'seed'; seed: string }

/**
 * Worker → main thread. Exactly one reply per request, in arrival order.
 * `scramble` replies carry a ScramblePayload when asked for an image (or a
 * plain string when not), `image` replies a bare SVG or null, `seed` null.
 */
export type ScrambleResponse =
  | { id: number; ok: true; value: string | ScramblePayload | null }
  | { id: number; ok: false; error: string }
