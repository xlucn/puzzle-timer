#!/usr/bin/env node
/*
 * ga-icon.mjs — the app icon generator: compute a PLL Ga state from the
 * canonical algorithm and emit an SVG cube. The state is derived (stickers
 * rotated in 3D), never drawn by hand, so the picture cannot disagree with
 * the algebra.
 *
 * Usage:
 *   node tools/icon/ga-icon.mjs [out.svg] [elevationDegrees]
 *
 * Elevation defaults to 25° — deliberately below true isometric (35.264°), so
 * the flat top foreshortens and the F/R faces take over the picture. See
 * PLAN.md M12 → Icon for the direction and the measurements behind it. The
 * scale is fitted to the projected bounding box, so any angle keeps the same
 * visual weight (and 35.264° reproduces the original isometric render
 * exactly).
 *
 * Plain Node — no gi:, no display — so it runs headless like the rest of
 * tools/.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ---- 3D sticker model -------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scl = (s, a) => [s * a[0], s * a[1], s * a[2]]
const eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

/** Rotation about a principal axis; dir=+1 is +90° (right-hand rule). */
function rot(v, axis, dir) {
  const [x, y, z] = v
  if (axis === 0) return dir > 0 ? [x, -z, y] : [x, z, -y]
  if (axis === 1) return dir > 0 ? [z, y, -x] : [-z, y, x]
  return dir > 0 ? [-y, x, z] : [y, -x, z]
}

/* Each face carries its own in-plane axes (u = screen right, v = screen
 * down) as seen from outside, so the render matches what an eye sees. */
const FACES = [
  { id: 'U', n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], color: 'U' },
  { id: 'D', n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1], color: 'D' },
  { id: 'F', n: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0], color: 'F' },
  { id: 'B', n: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0], color: 'B' },
  { id: 'R', n: [1, 0, 0], u: [0, 0, -1], v: [0, -1, 0], color: 'R' },
  { id: 'L', n: [-1, 0, 0], u: [0, 0, 1], v: [0, -1, 0], color: 'L' },
]
const FACE = Object.fromEntries(FACES.map((f) => [f.id, f]))

let stickers = []
function reset() {
  stickers = []
  for (const f of FACES)
    for (let r = -1; r <= 1; r++)
      for (let c = -1; c <= 1; c++)
        stickers.push({ p: add(f.n, add(scl(c, f.u), scl(r, f.v))), n: f.n, c: f.color })
}
const snapshot = () =>
  stickers.map((s) => `${s.p.join(',')}|${s.n.join(',')}|${s.c}`).sort().join(';')

/* Face letters: [axis, layer coordinate, direction]. A quarter turn of R is
 * clockwise as seen from +X, i.e. −90° about +X under the right-hand rule. */
const MOVES = {
  U: [1, 1, -1], D: [1, -1, 1],
  F: [2, 1, -1], B: [2, -1, 1],
  R: [0, 1, -1], L: [0, -1, 1],
}

function applyToken(tok) {
  // Wide moves ('u' = top two layers) are needed by an alternative Ga alg.
  const wide = tok[0] === tok[0].toLowerCase()
  const [ax, layer, dr] = MOVES[tok[0].toUpperCase()]
  const layers = wide ? [layer, 0] : [layer]
  const turns = tok[1] === '2' ? 2 : tok[1] === "'" ? 3 : 1
  for (let i = 0; i < turns; i++)
    for (const s of stickers)
      if (layers.includes(s.p[ax])) { s.p = rot(s.p, ax, dr); s.n = rot(s.n, ax, dr) }
}
function apply(alg) {
  for (const tok of alg.trim().split(/\s+/)) if (tok) applyToken(tok)
}
function invert(alg) {
  return alg.trim().split(/\s+/).reverse().map((t) => {
    if (t.length === 1) return `${t}'`
    if (t[1] === "'") return t[0]
    return t // '2' is self-inverse
  }).join(' ')
}

// ---- self-tests -------------------------------------------------------
function test(name, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) process.exitCode = 1
}

reset()
{
  for (const m of Object.keys(MOVES)) {
    const a = snapshot()
    for (let i = 0; i < 4; i++) applyToken(m)
    test(`${m} applied four times returns to start`, snapshot() === a)
  }
  const a = snapshot()
  apply('R U R\' U\'')
  apply(invert('R U R\' U\''))
  test('an algorithm followed by its inverse is a no-op', snapshot() === a)
}

// ---- the Ga algorithm -------------------------------------------------
const GA = "R2 U R' U R' U' R U' R2 D U' R' U R D'"

/** The state the algorithm *solves* is its inverse applied to solved. */
function build(alg) { reset(); apply(alg) }

/** Everything visible on the last layer's band (the four side top rows). */
function band() {
  const rows = {}
  for (const id of ['F', 'R', 'B', 'L']) {
    const f = FACE[id]
    // Top row of the side face: r = -1, because v points down (−Y).
    rows[id] = [-1, 0, 1].map((c) => {
      const p = add(f.n, add(scl(c, f.u), scl(-1, f.v)))
      const s = stickers.find((x) => eq(x.p, p) && eq(x.n, f.n))
      return s ? s.c : '?'
    })
  }
  return rows
}

/** Structural checks: only the U layer may have moved, and it must stay oriented. */
function integrity() {
  const uOk = [-1, 0, 1].every((r) => [-1, 0, 1].every((c) => {
    const s = stickers.find((x) => eq(x.p, add(FACE.U.n, add(scl(c, FACE.U.u), scl(r, FACE.U.v)))) && eq(x.n, FACE.U.n))
    return s && s.c === 'U'
  }))
  const lowerOk = ['F', 'R', 'B', 'L'].every((id) => {
    const f = FACE[id]
    return [0, 1].every((r) => [-1, 0, 1].every((c) => {
      const p = add(f.n, add(scl(c, f.u), scl(r, f.v)))
      const s = stickers.find((x) => eq(x.p, p) && eq(x.n, f.n))
      return s && s.c === f.color
    }))
  })
  const dOk = [-1, 0, 1].every((r) => [-1, 0, 1].every((c) => {
    const s = stickers.find((x) => eq(x.p, add(FACE.D.n, add(scl(c, FACE.D.u), scl(r, FACE.D.v)))) && eq(x.n, FACE.D.n))
    return s && s.c === 'D'
  }))
  return { uOk, lowerOk, dOk }
}

/** Home colour-set for a corner (all coords ±1) or edge (exactly one zero). */
function homeSet(p) {
  const set = []
  if (p[0] === 1) set.push('R'); if (p[0] === -1) set.push('L')
  if (p[1] === 1) set.push('U'); if (p[1] === -1) set.push('D')
  if (p[2] === 1) set.push('F'); if (p[2] === -1) set.push('B')
  return set.sort().join('')
}
function pieceList(kind) {
  const out = []
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) {
        const zeros = [x, y, z].filter((v) => v === 0).length
        if (kind === 'corner' ? zeros === 0 : zeros === 1) out.push([x, y, z])
      }
  return out
}
function colourSetAt(pos) {
  return stickers
    .filter((s) => eq(s.p, pos))
    .map((s) => s.c)
    .sort()
    .join('')
}
function parity(kind) {
  const positions = pieceList(kind)
  const homes = positions.map(homeSet)
  const perm = positions.map((pos) => homes.indexOf(colourSetAt(pos)))
  if (perm.some((v) => v < 0)) return { parity: NaN, cycles: 0 }
  const seen = new Array(perm.length).fill(false)
  let cycles = 0
  for (let i = 0; i < perm.length; i++) {
    if (seen[i]) continue
    cycles++
    let j = i
    while (!seen[j]) { seen[j] = true; j = perm[j] }
  }
  return { parity: (perm.length - cycles) % 2, cycles }
}

// ---- recognition ------------------------------------------------------
const ADJ = { R: 'B', B: 'L', L: 'O', O: 'R', G: 'O', W: 'Y', Y: 'W' }
const COLOR = {
  U: 'yellow', D: 'white', F: 'green', B: 'blue', R: 'orange', L: 'red',
}
function describe(tag, alg) {
  build(alg)
  const int = integrity()
  const rows = band()
  const headlights = Object.entries(rows).filter(([, r]) => r[0] === r[2]).map(([k]) => k)
  const inPlace = Object.entries(rows)
    .filter(([k, r]) => r.every((c) => c === FACE[k].color))
    .map(([k]) => k)
  const cp = parity('corner')
  const ep = parity('edge')
  console.log(`\n${tag}: ${alg}`)
  console.log(`  U oriented: ${int.uOk} | D solved: ${int.dOk} | lower two rows solved: ${int.lowerOk}`)
  console.log(`  band (top row of F,R,B,L — sticker order left→right as drawn):`)
  for (const [k, r] of Object.entries(rows))
    console.log(`    ${k}: ${r.map((c) => COLOR[c].padEnd(6)).join(' ')}${headlights.includes(k) ? '   <-- headlights' : ''}${inPlace.includes(k) ? '   <-- all three in place' : ''}`)
  console.log(`  corner cycles: ${cp.cycles} (parity ${cp.parity}) | edge cycles: ${ep.cycles} (parity ${ep.parity}) | parity match: ${cp.parity === ep.parity}`)
  console.log(`  headlights on: ${headlights.length ? headlights.join(', ') : 'none'} | sides fully in place: ${inPlace.length ? inPlace.join(', ') : 'none'}`)
  return { int, rows }
}

console.log('Self-tests:')
console.log(`  GA inverse = ${invert(GA)}`)
const asSolved = describe(`alg applied TO solved (= the case THAT ALG SOLVES)`, GA)
const gaState = describe(`inverse alg applied to solved (= the GA STATE)`, invert(GA))

// ---- SVG --------------------------------------------------------------
const HEX = {
  U: '#FFD500', D: '#F4F4F4', F: '#009A45',
  B: '#0053BB', R: '#FF6A00', L: '#D8232A',
}
/* Viewing elevation, in degrees: the angle the camera looks down from.
   True isometric is 35.264°. Lowering it turns the view down — the top face
   is foreshortened (less of it, so less flat colour up there) while the two
   side faces grow. The 1/cos(elev) normalisation keeps the vertical unit at
   1, so the default reproduces the previous output exactly. */
const ELEV_DEG = Number(process.argv[3] ?? 25)
const ELEV = (ELEV_DEG * Math.PI) / 180
const COS = Math.cos(ELEV)
const SIN = Math.sin(ELEV)
const proj = (p) => [
  (p[0] - p[2]) / (Math.SQRT2 * COS),
  ((p[0] + p[2]) * SIN) / (Math.SQRT2 * COS) - p[1],
]
const CX = 64, CY = 64

/* Fit to the projected bounding box rather than a hard-coded scale: the box
   changes with the angle, and this keeps the cube the same apparent size.
   FIT = 99.6 makes the isometric case land on the previous scale of 16.6. */
const FIT = 99.6
const corners = []
for (const x of [-1.5, 1.5]) for (const y of [-1.5, 1.5]) for (const z of [-1.5, 1.5]) corners.push(proj([x, y, z]))
const boxW = Math.max(...corners.map((p) => p[0])) - Math.min(...corners.map((p) => p[0]))
const boxH = Math.max(...corners.map((p) => p[1])) - Math.min(...corners.map((p) => p[1]))
const SCALE = Math.min(FIT / boxW, FIT / boxH)
const scr = (p) => { const [x, y] = proj(p); return [CX + x * SCALE, CY + y * SCALE] }

/* Shading: light from above — top face full, the two visible sides darker,
 * per the HIG's "front profile is shaded darker than the top surface". */
const SHADE = { U: 1.0, F: 0.93, R: 0.86 }

function svg(alg) {
  build(alg)
  const out = []
  out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">')
  out.push('  <!-- generated: isometric 3x3, PLL Ga state (yellow on top) -->')

  // The plastic body: one dark polygon per visible face, drawn first.
  // Faces live on the *surface* (1.5 × normal) — in an isometric projection
  // depth changes screen position, so drawing them at the sticker-centre
  // plane makes the three faces miss each other at the seams.
  for (const id of ['U', 'F', 'R']) {
    const f = FACE[id]
    const corners = []
    for (const [a, b] of [[1, 1], [1, -1], [-1, -1], [-1, 1]])
      corners.push(scr(add(scl(1.5, f.n), add(scl(1.5 * a, f.u), scl(1.5 * b, f.v)))))
    out.push(`  <path d="M ${corners.map((c) => `${c[0].toFixed(2)} ${c[1].toFixed(2)}`).join(' L ')} Z" fill="#1B1B1F"/>`)
  }

  // Stickers: a <rect> in a matrix transform, so the corners stay rounded
  // after the isometric skew.
  for (const id of ['U', 'F', 'R']) {
    const f = FACE[id]
    for (let r = -1; r <= 1; r++)
      for (let c = -1; c <= 1; c++) {
        const p = add(f.n, add(scl(c, f.u), scl(r, f.v)))
        const s = stickers.find((x) => eq(x.p, p) && eq(x.n, f.n))
        if (!s) continue
        const onSurface = add(p, scl(0.5, f.n))
        const origin = scr(add(onSurface, add(scl(-0.43, f.u), scl(-0.43, f.v))))
        // Edge vectors of the sticker, projected: they become the matrix that
        // carries a unit square onto the isometric parallelogram.
        const dU = proj(scl(0.86, f.u)).map((v) => v * SCALE)
        const dV = proj(scl(0.86, f.v)).map((v) => v * SCALE)
        const shade = SHADE[id]
        const hex = HEX[s.c]
        const rgb = [1, 3, 5].map((i) => {
          const ch = hex.slice(i, i + 2)
          return Math.max(0, Math.min(255, Math.round(parseInt(ch, 16) * shade)))
        })
        const fill = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
        out.push(
          `  <rect x="0" y="0" width="1" height="1" rx="0.16" fill="${fill}" ` +
          `transform="matrix(${dU[0].toFixed(3)} ${dU[1].toFixed(3)} ${dV[0].toFixed(3)} ${dV[1].toFixed(3)} ${origin[0].toFixed(3)} ${origin[1].toFixed(3)})"/>`,
        )
      }
  }
  out.push('</svg>')
  return `${out.join('\n')}\n`
}

// ---- cross-check ------------------------------------------------------
/* Three *different* published "Ga" algorithms. The state each one solves is
   its inverse applied to a solved cube — so if all three agree, the state is
   the Ga case regardless of which source you trust. */
const GA_ALTS = [
  "R2 U R' U R' U' R U' R2 D U' R' U R D'", // speedcubing.org, recommended
  "R2 u R' U R' U' R u' R2 F' U F", //           same page, alternative
  "D' R2 U R' U R' U' R U' R2 U' D R' U R", //   same page, alternative
]
console.log('\nCross-check: three published "Ga" algs, each inverted onto a solved cube')
const keys = GA_ALTS.map((alg) => { build(invert(alg)); return snapshot() })
GA_ALTS.forEach((alg, i) => console.log(`  ${keys[i] === keys[0] ? 'SAME STATE   ' : 'DIFFERENT!!  '}${alg}`))

/* A PLL case looks different if you hold the cube rotated, so an alg written
   for another viewing angle yields a y-rotation of the same case rather than
   the identical sticker arrangement. Check for that before declaring a
   disagreement. */
function wholeY() {
  for (const s of stickers) { s.p = rot(s.p, 1, -1); s.n = rot(s.n, 1, -1) }
}
console.log('  orientation check (a y-rotation of each against the first):')
for (let i = 1; i < GA_ALTS.length; i++) {
  const found = []
  for (let k = 0; k < 4; k++) {
    build(invert(GA_ALTS[i]))
    for (let t = 0; t < k; t++) wholeY()
    if (snapshot() === keys[0]) found.push(`y^${k}`)
  }
  console.log(`    ${i === 1 ? 'alg 2' : 'alg 3'}: ${found.length ? `same case held rotated (${found.join(', ')})` : 'not a rotation of alg 1 — genuinely different'}`)
}

// Default output sits beside the generator, so running it from anywhere does
// not scatter files.
const file = process.argv[2] ?? fileURLToPath(new URL('./ga-cube.svg', import.meta.url))
writeFileSync(file, svg(invert(GA)))
console.log(`\nWrote ${file}`)
