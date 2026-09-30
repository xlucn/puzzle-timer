/*
 * protocol.ts — messages exchanged with the scramble worker.
 *
 * Plain data only: it is structured-cloned across the thread boundary, so no
 * functions, no class instances, no `gi:*`.
 */

/** Main thread → worker. `id` is echoed back in the reply. */
export type ScrambleRequest =
  | { id: number; cmd: 'scramble'; type: string; length: number }
  | { id: number; cmd: 'seed'; seed: string }

/** Worker → main thread. Exactly one reply per request, in arrival order. */
export type ScrambleResponse =
  | { id: number; ok: true; value: string | null }
  | { id: number; ok: false; error: string }
