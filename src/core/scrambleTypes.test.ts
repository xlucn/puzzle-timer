import { describe, expect, it } from 'vitest'

import {
  SCRAMBLE_DEFAULT_TYPE,
  SCRAMBLE_GROUPS,
  SCRAMBLE_TYPES,
  groupOfScrambleType,
  scrambleLength,
  scrambleTypeLabel,
} from './scrambleTypes.js'

/**
 * The 206 ids cstimer_module v0.1.5 reports from getScrambleTypes(). If the
 * dependency is ever bumped, `node --import tsx tools/scramble_probe.ts`
 * prints the difference and this number is updated to match.
 */
const CSTIMER_MODULE_TYPE_COUNT = 206

describe('scrambleTypes', () => {
  it('offers every type cstimer_module provides', () => {
    expect(SCRAMBLE_TYPES).toHaveLength(CSTIMER_MODULE_TYPE_COUNT)
    expect(new Set(SCRAMBLE_TYPES.map((type) => type.id)).size).toBe(
      CSTIMER_MODULE_TYPE_COUNT,
    )
  })

  it('starts on the 3x3 random-state scramble, like csTimer', () => {
    expect(SCRAMBLE_DEFAULT_TYPE).toBe('333')
    expect(SCRAMBLE_TYPES.some((type) => type.id === SCRAMBLE_DEFAULT_TYPE)).toBe(true)
  })

  it('gives every type a name, a group and a usable length', () => {
    for (const type of SCRAMBLE_TYPES) {
      expect(type.id, 'id').not.toBe('')
      expect(type.name.trim(), `${type.id} name`).not.toBe('')
      expect(type.group.trim(), `${type.id} group`).not.toBe('')
      expect(type.defaultLength, `${type.id} length`).toBeGreaterThanOrEqual(0)
    }
  })

  it('uses the lengths csTimer passes to the scrambler', () => {
    // random-state scramblers: length 0 selects the solver
    expect(scrambleLength('333')).toBe(0)
    expect(scrambleLength('222so')).toBe(0)
    // random-move scramblers need a positive length or they generate nothing
    expect(scrambleLength('444wca')).toBe(40) // csTimer's menu stores -40
    expect(scrambleLength('555wca')).toBe(60)
    expect(scrambleLength('777wca')).toBe(100)
    expect(scrambleLength('333o')).toBe(25)
    expect(scrambleLength('r3ni')).toBe(5) // five cubes for multi-blind
    // unknown ids fall back to 0 (the feed reports the empty result)
    expect(scrambleLength('no-such-type')).toBe(0)
  })

  it('builds the two selector levels csTimer uses: category, then type', () => {
    // level 1: categories in csTimer's menu order
    expect(SCRAMBLE_GROUPS.map((group) => group.name)).toContain('WCA')
    expect(SCRAMBLE_GROUPS[0].name).toBe('WCA')
    expect(SCRAMBLE_GROUPS.map((group) => group.name)).toEqual(
      [...new Set(SCRAMBLE_TYPES.map((type) => type.group))],
    )

    // level 2: every type appears exactly once, in menu order, and nothing is
    // invented or dropped by the regrouping
    const flat = SCRAMBLE_GROUPS.flatMap((group) =>
      group.choices.map((choice) => choice.id),
    )
    expect(flat).toEqual(SCRAMBLE_TYPES.map((type) => type.id))
    expect(new Set(flat).size).toBe(flat.length)
  })

  it('keeps names unique inside their group, so level 2 needs no prefix', () => {
    for (const group of SCRAMBLE_GROUPS) {
      const labels = group.choices.map((choice) => choice.label)
      expect(new Set(labels).size, `duplicates in ${group.name}`).toBe(labels.length)
      for (const choice of group.choices) {
        expect(choice.label.trim(), `${choice.id} label`).not.toBe('')
        expect(choice.defaultLength).toBe(scrambleLength(choice.id))
      }
    }

    // names csTimer reuses across submenus — each unique within its own group
    expect(
      SCRAMBLE_GROUPS.find((group) => group.name === '3x3x3 CFOP')?.choices.find(
        (choice) => choice.id === 'pll',
      )?.label,
    ).toBe('PLL')
    expect(
      SCRAMBLE_GROUPS.find((group) => group.name === 'Square-1')?.choices.find(
        (choice) => choice.id === 'sq1pll',
      )?.label,
    ).toBe('PLL')
    // …so the level-1 selector must point back at the right category
    expect(groupOfScrambleType('pll')).toBe('3x3x3 CFOP')
    expect(groupOfScrambleType('sq1pll')).toBe('Square-1')
    expect(groupOfScrambleType('333')).toBe('WCA')
    expect(groupOfScrambleType('no-such-type')).toBeUndefined()
  })
})

describe('scrambleTypeLabel — both levels on one line', () => {
  it('prefixes the group, because a name is only unique inside its group', () => {
    expect(scrambleTypeLabel('333')).toBe('WCA - 3x3x3')
    // The two "PLL"s: the same level-2 name in different categories, which is
    // exactly what the prefix exists to separate.
    expect(scrambleTypeLabel('pll')).toBe('3x3x3 CFOP - PLL')
    expect(scrambleTypeLabel('sq1pll')).toBe('Square-1 - PLL')
  })

  it('is the catalogue, one label per type', () => {
    expect(SCRAMBLE_TYPES).toHaveLength(206)
    for (const type of SCRAMBLE_TYPES) {
      expect(scrambleTypeLabel(type.id), type.id).toBe(`${type.group} - ${type.name}`)
    }
  })

  it('shows an unknown id verbatim instead of substituting one', () => {
    expect(scrambleTypeLabel('no-such-type')).toBe('no-such-type')
  })
})
