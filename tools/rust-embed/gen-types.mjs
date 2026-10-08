#!/usr/bin/env node
/*
 * gen-types.mjs — regenerate types.json from the app's own catalogue.
 *
 * The probes must use the same 206 ids *and the same default lengths* the app
 * passes to getScramble(); reading them from src/core/scrambleTypes.ts keeps
 * the harness honest when the catalogue changes. Run via tsx, as the app does:
 *
 *   node --import tsx tools/rust-embed/gen-types.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { SCRAMBLE_TYPES } = await import(
  new URL('../../src/core/scrambleTypes.ts', import.meta.url).href
);

const out = SCRAMBLE_TYPES.map((t) => ({ id: t.id, len: t.defaultLength }));
writeFileSync(join(here, 'types.json'), JSON.stringify(out));
console.log(`wrote ${out.length} types -> ${join(here, 'types.json')}`);
