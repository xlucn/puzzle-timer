/*
 * cstimerLang.ts — the csTimer language strings cstimer_module expects but
 * does not bundle.
 *
 * cstimer_module packages the scramblers, not csTimer's `src/lang/*.js`
 * strings, and one scrambler reads two of them as globals:
 *
 *   SCRAMBLE_NOOBST / SCRAMBLE_NOOBSS — the "3x3x3 for noobs" wording
 *   (csTimer's src/lang/en-us.js, GPL-3.0, © Shuang Chen and contributors).
 *
 * Without them `getScramble('333noob', …)` throws `SCRAMBLE_NOOBST is not
 * defined`, so 205 of the 206 types would work instead of all of them.
 * Values are verbatim from en-us.js.
 */

const SCRAMBLE_NOOBST = [
  ['turn the top face', 'turn the bottom face'],
  ['turn the right face', 'turn the left face'],
  ['turn the front face', 'turn the back face'],
]

const SCRAMBLE_NOOBSS =
  ' clockwise by 90 degrees,| counterclockwise by 90 degrees,| by 180 degrees,'

/**
 * Put the strings where the bundled scrambler can see them. cstimer_module
 * runs its bundle against the global object (`global.self = global` in Node),
 * so this is enough — call it before generating anything.
 */
export function applyCsTimerLangStrings(): void {
  Object.assign(globalThis, { SCRAMBLE_NOOBST, SCRAMBLE_NOOBSS })
}
