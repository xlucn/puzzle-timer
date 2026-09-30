/*
 * random.ts — CSPRNG helpers (Node's WebCrypto).
 *
 * Architecture rule (see AGENTS.md): Node-specific code lives in
 * src/platform/, never in src/core/.
 */

/**
 * A 64-hex-character seed from the CSPRNG, handed to cstimer_module's
 * setSeed() when the scramble worker starts.
 *
 * Seeding deliberately (rather than letting the module decide) keeps the
 * source of randomness explicit: Node guarantees `crypto.getRandomValues`
 * here, whereas cstimer_module falls back to the wall clock when no CSPRNG
 * is visible, which would make scrambles predictable.
 */
export function randomSeed(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
