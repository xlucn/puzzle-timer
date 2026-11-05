/*
 * prescr_probe.mjs — what csTimer's `preScr` global changes.
 *
 * Takes ONE scramble per type, draws its diagram twice — with `preScr` empty
 * and with `preScr = 'y'` — and writes both SVGs out, so the claim behind the
 * pre-scramble preference can be checked rather than trusted:
 *
 *   - `setGlobal('preScr', …)` changes `getImage()` for the same scramble;
 *   - it does not change `getScramble()`'s text, and passing a third argument
 *     to `getScramble()` does not either;
 *   - drawing `"y " + scramble` by hand gives the same picture as the global.
 *
 *   node --import tsx tools/prescr_probe.mjs
 *
 * Output: /tmp/opencode/prescr-<type>-plain.svg and -preScr-y.svg.
 */
import { writeFileSync } from 'node:fs'

import cstimer from 'cstimer_module'

const PREFIX = 'y'

for (const [type, length] of [
  ['333', 0], // random-state 3x3
  ['444m', 40], // fast 4x4 (random move)
]) {
  // 1. One scramble, drawn with no pre-scramble.
  cstimer.setGlobal('preScr', '')
  const scramble = cstimer.getScramble(type, length)
  const plain = String(cstimer.getImage(scramble, type))

  // 2. The same scramble, drawn with the global set.
  cstimer.setGlobal('preScr', PREFIX)
  const withGlobal = String(cstimer.getImage(scramble, type))
  const textAfter = cstimer.getScramble(type, length)

  // 3. The same scramble, drawn by putting the prefix into the text instead.
  cstimer.setGlobal('preScr', '')
  const withText = String(cstimer.getImage(`${PREFIX} ${scramble}`, type))

  const plainPath = `/tmp/opencode/prescr-${type}-plain.svg`
  const globalPath = `/tmp/opencode/prescr-${type}-preScr-y.svg`
  writeFileSync(plainPath, plain)
  writeFileSync(globalPath, withGlobal)

  console.log(`\n===== ${type}${length ? ` (length ${length})` : ''}`)
  console.log('scramble            :', scramble)
  console.log(`preScr=""     image : ${plain.length} bytes -> ${plainPath}`)
  console.log(`preScr="y"    image : ${withGlobal.length} bytes -> ${globalPath}`)
  console.log('images differ       :', plain !== withGlobal)
  console.log(
    'getScramble affected:',
    textAfter.startsWith(`${PREFIX} `)
      ? 'YES (text now starts with "y ")'
      : `no (still a plain scramble: ${textAfter.slice(0, 24)}…)`,
  )
  console.log('prefix in text === global:', withText === withGlobal)
}

cstimer.setGlobal('preScr', '')
console.log('\ndone — open the two SVGs for one type side by side.')
