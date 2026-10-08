// Reference dump: same seed, same type order, same getImage interleaving as
// the engine sweeps, so any RNG-alignment difference shows up as a diff.
const fs = require('fs');
const path = require('path');
const cstimer = require('cstimer_module');

// Same lang injection the app does (src/scramble/cstimerLang.ts) — without it
// 333noob throws and the shared RNG stream diverges for every later type.
globalThis.SCRAMBLE_NOOBST = [
  ['turn the top face', 'turn the bottom face'],
  ['turn the right face', 'turn the left face'],
  ['turn the front face', 'turn the back face'],
];
globalThis.SCRAMBLE_NOOBSS =
  ' clockwise by 90 degrees,| counterclockwise by 90 degrees,| by 180 degrees,';

const types = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'types.json'), 'utf8'),
);

cstimer.setSeed('42');
console.log('===DUMP===');
let ok = 0;
let empty = 0;
let img = 0;
const slow = [];
const tAll = Date.now();
for (const ty of types) {
  const s0 = Date.now();
  let scr;
  try {
    scr = cstimer.getScramble(ty.id, ty.len);
  } catch (e) {
    console.log(`${ty.id}\t${JSON.stringify('ERROR ' + e.message)}`);
    continue;
  }
  slow.push([Date.now() - s0, ty.id]);
  console.log(`${ty.id}\t${JSON.stringify(String(scr))}`);
  if (String(scr).trim() === '') empty += 1;
  else ok += 1;
  try {
    const im = cstimer.getImage(scr, ty.id);
    if (typeof im === 'string' && im.length) img += 1;
  } catch (e) {
    /* image failures must not affect RNG alignment */
  }
}
slow.sort((a, b) => b[0] - a[0]);
console.log('===COUNTS===');
console.log(
  `generated OK=${ok} empty=${empty} images=${img} failures=0 total=${types.length}`,
);
console.log(`sweep wall time: ${Date.now() - tAll}ms`);
console.log('slowest types:');
for (const [ms, id] of slow.slice(0, 5)) console.log(`  ${id} ${ms}ms`);
