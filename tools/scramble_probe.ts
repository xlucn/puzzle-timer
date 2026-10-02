/*
 * scramble_probe.ts — does every scramble type actually generate?
 *
 * The M1 acceptance criterion is "206 types, zero UI freezes". This proves
 * the first half from the command line: it walks the app's own catalogue
 * (src/core/scrambleTypes.ts) and asks cstimer_module — on this machine, in
 * this process — for one scramble of each type, with the same length the app
 * passes. The second half is architecture (the scrambler runs in a worker
 * thread) plus tools/timer_walk.py-style key driving while a slow type
 * generates.
 *
 * It also cross-checks the two lists, so bumping cstimer_module without
 * updating the table cannot pass unnoticed:
 *   - ids in the module but not in the table → an unreachable type;
 *   - ids in the table but not in the module → a selector row that can only
 *     ever fail.
 *
 * Usage (needs no display, no worker):
 *   node --import tsx tools/scramble_probe.ts            every type
 *   node --import tsx tools/scramble_probe.ts 444wca     one type
 *   node --import tsx tools/scramble_probe.ts --quiet    summary only
 *
 * Exits 1 on any missing, failing or empty type.
 */
import cstimer from 'cstimer_module'

import { SCRAMBLE_TYPES, scrambleLength } from '../src/core/scrambleTypes.js'
import { applyCsTimerLangStrings } from '../src/scramble/cstimerLang.js'

// Same preparation the worker does: one scrambler needs csTimer's strings.
applyCsTimerLangStrings()

const args = process.argv.slice(2)
const quiet = args.includes('--quiet')
const only = args.filter((arg) => !arg.startsWith('--'))

const moduleIds: string[] = cstimer.getScrambleTypes()
const tableIds = SCRAMBLE_TYPES.map((type) => type.id)

const missingFromTable = moduleIds.filter((id) => !tableIds.includes(id))
const missingFromModule = tableIds.filter((id) => !moduleIds.includes(id))

interface Row {
  id: string
  label: string
  ms: number
  moves: number
  /** SVG image for this scramble (M5): 'svg', 'none' (29 types), or a fault. */
  image: 'svg' | 'none' | 'broken'
  error?: string
}

const targets = only.length > 0 ? only : moduleIds.filter((id) => tableIds.includes(id))
const rows: Row[] = []

for (const id of targets) {
  const length = scrambleLength(id)
  const type = SCRAMBLE_TYPES.find((entry) => entry.id === id)
  const label = type ? `${type.group} · ${type.name}` : '—'
  const started = process.hrtime.bigint()
  let image: Row['image'] = 'none'
  try {
    const text = cstimer.getScramble(id, length)
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    if (text.length === 0) {
      rows.push({ id, label, ms, moves: 0, image, error: 'empty scramble' })
    } else {
      // Same contract as the worker's imageOf(): an SVG string, or a falsey
      // answer for the types with no drawing rule. Anything else (a thrown
      // error, an unexpected string) would poison the panel and is a failure.
      try {
        const svg: unknown = cstimer.getImage(text, id)
        if (typeof svg === 'string' && svg.startsWith('<')) image = 'svg'
        else if (!svg) image = 'none'
        else {
          image = 'broken'
          rows.push({ id, label, ms, moves: text.split(/\s+/).length, image, error: `getImage returned ${JSON.stringify(svg)?.slice(0, 40)}` })
        }
      } catch (error) {
        image = 'broken'
        rows.push({ id, label, ms, moves: 0, image, error: `getImage threw: ${error instanceof Error ? error.message : String(error)}` })
      }
      if (image !== 'broken') rows.push({ id, label, ms, moves: text.split(/\s+/).length, image })
    }
  } catch (error) {
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    rows.push({ id, label, ms, moves: 0, image, error: error instanceof Error ? error.message : String(error) })
  }
}

const failures = rows.filter((row) => row.error !== undefined)

if (!quiet) {
  const idWidth = Math.max(4, ...rows.map((row) => row.id.length))
  const labelWidth = Math.max(5, ...rows.map((row) => row.label.length))
  console.log(
    `${'id'.padEnd(idWidth)}  ${'type'.padEnd(labelWidth)}  ${'len'.padStart(3)}  ${'ms'.padStart(7)}  ${'words'.padStart(5)}  image`,
  )
  for (const row of rows) {
    const length = scrambleLength(row.id)
    console.log(
      `${row.id.padEnd(idWidth)}  ${row.label.padEnd(labelWidth)}  ${String(length).padStart(3)}  ` +
        `${row.ms.toFixed(1).padStart(7)}  ` +
        (row.error ? `ERROR: ${row.error}` : String(row.moves).padStart(5)) +
        `  ${row.image}`,
    )
  }
}

const slowest = [...rows].filter((row) => row.error === undefined).sort((a, b) => b.ms - a.ms)[0]
const images = rows.filter((row) => row.image === 'svg').length
const noImages = rows.filter((row) => row.image === 'none').length

console.log(
  `\n${rows.length - failures.length}/${rows.length} types generated` +
    `; ${images} with images, ${noImages} without` +
    (slowest ? `; slowest ${slowest.id} at ${slowest.ms.toFixed(0)} ms` : ''),
)

if (missingFromTable.length > 0) {
  console.log(`\nin cstimer_module but NOT in our table: ${missingFromTable.join(', ')}`)
}
if (missingFromModule.length > 0) {
  console.log(`\nin our table but NOT in cstimer_module: ${missingFromModule.join(', ')}`)
}

const ok = failures.length === 0 && missingFromTable.length === 0 && missingFromModule.length === 0
if (!ok) console.error('\nFAILED')
process.exit(ok ? 0 : 1)
