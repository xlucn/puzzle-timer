/*
 * scrambleTypes.ts — the catalogue of scramble types csTimer offers.
 *
 * Architecture rule (see AGENTS.md): pure TypeScript — no `gi:*`, no Node
 * APIs, and no `cstimer_module` import. The ids and default lengths are the
 * data the scrambler needs at generation time; keeping them here means the
 * selector builds synchronously (no async startup) and the table itself can
 * be unit-tested without a worker or a display.
 *
 * Source of the data: csTimer's menu definition `scrdata` in
 * `src/lang/en-us.js` (GPL-3.0, © Shuang Chen and contributors) — the display
 * names, the menu groups and the length csTimer passes to the scrambler.
 * Only that data was taken, no code; csTimer and `cstimer_module` are
 * credited in the About dialog.
 *
 *   - `id` is what cstimer_module's getScramble(type, length) expects.
 *   - `defaultLength` is |len| from csTimer's menu entry. csTimer shows the
 *     absolute value in its length field and passes exactly that, so -40 for
 *     444wca becomes 40. The length matters: random-move scramblers need a
 *     positive one (getScramble('555wca', 0) returns ""), while random-state
 *     ones want 0 (getScramble('333', 25) would be the wrong generator).
 *   - `2226` is not in csTimer's menu at all: it is cstimer_module's 2x2
 *     6-gen scrambler, the counterpart of csTimer's `2223` "3-gen", so it
 *     gets the same default length.
 *
 * All 206 ids match cstimer_module v0.1.5's getScrambleTypes(). Verify with
 * `node --import tsx tools/scramble_probe.ts`, which generates one scramble
 * of every type and fails on errors or empty output.
 */

export interface ScrambleType {
  /** Id understood by cstimer_module. */
  id: string
  /** Display name, e.g. "3x3x3". */
  name: string
  /** csTimer menu group, e.g. "WCA" or "3x3x3 CFOP". */
  group: string
  /** Length argument for getScramble(); see the note above. */
  defaultLength: number
}

/** Type the app opens with — also csTimer's default. */
export const SCRAMBLE_DEFAULT_TYPE = '333'

export const SCRAMBLE_TYPES: readonly ScrambleType[] = [
  { id: '333', name: '3x3x3', group: 'WCA', defaultLength: 0 },
  { id: '222so', name: '2x2x2', group: 'WCA', defaultLength: 0 },
  { id: '444wca', name: '4x4x4', group: 'WCA', defaultLength: 40 },
  { id: '555wca', name: '5x5x5', group: 'WCA', defaultLength: 60 },
  { id: '666wca', name: '6x6x6', group: 'WCA', defaultLength: 80 },
  { id: '777wca', name: '7x7x7', group: 'WCA', defaultLength: 100 },
  { id: '333ni', name: '3x3 bld', group: 'WCA', defaultLength: 0 },
  { id: '333fm', name: '3x3 fm', group: 'WCA', defaultLength: 0 },
  { id: '333oh', name: '3x3 oh', group: 'WCA', defaultLength: 0 },
  { id: 'clkwca', name: 'clock', group: 'WCA', defaultLength: 0 },
  { id: 'mgmp', name: 'megaminx', group: 'WCA', defaultLength: 70 },
  { id: 'pyrso', name: 'pyraminx', group: 'WCA', defaultLength: 10 },
  { id: 'skbso', name: 'skewb', group: 'WCA', defaultLength: 0 },
  { id: 'ftoso', name: 'FTO', group: 'WCA', defaultLength: 0 },
  { id: 'sqrs', name: 'sq1', group: 'WCA', defaultLength: 0 },
  { id: '444bld', name: '4x4 bld', group: 'WCA', defaultLength: 40 },
  { id: '555bld', name: '5x5 bld', group: 'WCA', defaultLength: 60 },
  { id: 'r3ni', name: '3x3 mbld', group: 'WCA', defaultLength: 5 },
  { id: 'blank', name: '--', group: 'WCA', defaultLength: 0 },
  { id: '333o', name: 'random move', group: '3x3x3', defaultLength: 25 },
  { id: '333noob', name: '3x3x3 for noobs', group: '3x3x3', defaultLength: 25 },
  { id: 'edges', name: 'edges only', group: '3x3x3', defaultLength: 0 },
  { id: 'corners', name: 'corners only', group: '3x3x3', defaultLength: 0 },
  { id: '333ft', name: '3x3 ft', group: '3x3x3', defaultLength: 0 },
  { id: '333custom', name: 'Custom', group: '3x3x3', defaultLength: 0 },
  { id: 'pll', name: 'PLL', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: 'oll', name: 'OLL', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: 'lsll2', name: 'last slot + last layer', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: 'll', name: 'last layer', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: 'zbll', name: 'ZBLL', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: 'coll', name: 'COLL', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: 'cll', name: 'CLL', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: 'ell', name: 'ELL', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: '2gll', name: '2GLL', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: 'zzll', name: 'ZZLL', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: 'zbls', name: 'ZBLS', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: 'eols', name: 'EOLS', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: 'wvls', name: 'WVLS', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: 'vls', name: 'VLS', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: 'f2l', name: 'cross solved', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: 'eoline', name: 'EOLine', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: 'eocross', name: 'EO Cross', group: '3x3x3 CFOP', defaultLength: 0 },
  { id: 'easyc', name: 'easy cross', group: '3x3x3 CFOP', defaultLength: 3 },
  { id: 'easyxc', name: 'easy xcross', group: '3x3x3 CFOP', defaultLength: 4 },
  { id: 'sbrx', name: '2nd Block', group: '3x3x3 Roux', defaultLength: 0 },
  { id: 'cmll', name: 'CMLL', group: '3x3x3 Roux', defaultLength: 0 },
  { id: 'lse', name: 'LSE', group: '3x3x3 Roux', defaultLength: 0 },
  { id: 'lsemu', name: 'LSE <M, U>', group: '3x3x3 Roux', defaultLength: 0 },
  { id: 'mt3qb', name: '3QB', group: '3x3x3 Mehta', defaultLength: 0 },
  { id: 'mteole', name: 'EOLE', group: '3x3x3 Mehta', defaultLength: 0 },
  { id: 'mttdr', name: 'TDR', group: '3x3x3 Mehta', defaultLength: 0 },
  { id: 'mt6cp', name: '6CP', group: '3x3x3 Mehta', defaultLength: 0 },
  { id: 'mtcdrll', name: 'CDRLL', group: '3x3x3 Mehta', defaultLength: 0 },
  { id: 'mtl5ep', name: 'L5EP', group: '3x3x3 Mehta', defaultLength: 0 },
  { id: 'ttll', name: 'TTLL', group: '3x3x3 Mehta', defaultLength: 0 },
  { id: '222o', name: 'optimal', group: '2x2x2', defaultLength: 0 },
  { id: '2223', name: '3-gen', group: '2x2x2', defaultLength: 25 },
  { id: '2226', name: '6-gen', group: '2x2x2', defaultLength: 25 },
  { id: '222eg', name: 'EG', group: '2x2x2', defaultLength: 0 },
  { id: '222eg0', name: 'CLL', group: '2x2x2', defaultLength: 0 },
  { id: '222eg1', name: 'EG1', group: '2x2x2', defaultLength: 0 },
  { id: '222eg2', name: 'EG2', group: '2x2x2', defaultLength: 0 },
  { id: '222tcp', name: 'TCLL+', group: '2x2x2', defaultLength: 0 },
  { id: '222tcn', name: 'TCLL-', group: '2x2x2', defaultLength: 0 },
  { id: '222tc', name: 'TCLL', group: '2x2x2', defaultLength: 0 },
  { id: '222lsall', name: 'LS', group: '2x2x2', defaultLength: 0 },
  { id: '222nb', name: 'No Bar', group: '2x2x2', defaultLength: 0 },
  { id: '444m', name: 'random move', group: '4x4x4', defaultLength: 40 },
  { id: '444', name: 'SiGN', group: '4x4x4', defaultLength: 40 },
  { id: '444yj', name: 'YJ', group: '4x4x4', defaultLength: 40 },
  { id: '4edge', name: '4x4x4 edges', group: '4x4x4', defaultLength: 0 },
  { id: 'RrUu', name: 'R,r,U,u', group: '4x4x4', defaultLength: 40 },
  { id: '444ll', name: 'Last layer', group: '4x4x4', defaultLength: 0 },
  { id: '444ell', name: 'ELL', group: '4x4x4', defaultLength: 0 },
  { id: '444edo', name: 'Edge only', group: '4x4x4', defaultLength: 0 },
  { id: '444cto', name: 'Center only', group: '4x4x4', defaultLength: 0 },
  { id: '444ctud', name: 'UD center solved', group: '4x4x4 Yau/Hoya', defaultLength: 0 },
  { id: '444ud3c', name: 'UD+3E solved', group: '4x4x4 Yau/Hoya', defaultLength: 0 },
  { id: '444l8e', name: 'Last 8 dedges', group: '4x4x4 Yau/Hoya', defaultLength: 0 },
  { id: '444ctrl', name: 'RL center solved', group: '4x4x4 Yau/Hoya', defaultLength: 0 },
  { id: '444rlda', name: 'RLDX center solved', group: '4x4x4 Yau/Hoya', defaultLength: 0 },
  { id: '444rlca', name: 'RLDX cross solved', group: '4x4x4 Yau/Hoya', defaultLength: 0 },
  { id: '555', name: 'SiGN', group: '5x5x5', defaultLength: 60 },
  { id: '5edge', name: '5x5x5 edges', group: '5x5x5', defaultLength: 8 },
  { id: '666si', name: 'SiGN', group: '6x6x6', defaultLength: 80 },
  { id: '666p', name: 'prefix', group: '6x6x6', defaultLength: 80 },
  { id: '666s', name: 'suffix', group: '6x6x6', defaultLength: 80 },
  { id: '6edge', name: '6x6x6 edges', group: '6x6x6', defaultLength: 8 },
  { id: '777si', name: 'SiGN', group: '7x7x7', defaultLength: 100 },
  { id: '777p', name: 'prefix', group: '7x7x7', defaultLength: 100 },
  { id: '777s', name: 'suffix', group: '7x7x7', defaultLength: 100 },
  { id: '7edge', name: '7x7x7 edges', group: '7x7x7', defaultLength: 8 },
  { id: 'clkwcab', name: 'wca (old)', group: 'Clock', defaultLength: 0 },
  { id: 'clknf', name: 'WCA w/o y2', group: 'Clock', defaultLength: 0 },
  { id: 'clk', name: 'jaap', group: 'Clock', defaultLength: 0 },
  { id: 'clko', name: 'optimal', group: 'Clock', defaultLength: 0 },
  { id: 'clkc', name: 'concise', group: 'Clock', defaultLength: 0 },
  { id: 'clke', name: 'efficient pin order', group: 'Clock', defaultLength: 0 },
  { id: 'mgmc', name: 'Carrot', group: 'Megaminx', defaultLength: 70 },
  { id: 'mgmo', name: 'old style', group: 'Megaminx', defaultLength: 70 },
  { id: 'minx2g', name: '2-generator R,U', group: 'Megaminx', defaultLength: 30 },
  { id: 'mlsll', name: 'last slot + last layer', group: 'Megaminx', defaultLength: 0 },
  { id: 'mgmso', name: 'random state', group: 'Megaminx', defaultLength: 0 },
  { id: 'mgmpll', name: 'PLL', group: 'Megaminx', defaultLength: 0 },
  { id: 'mgmll', name: 'Last Layer', group: 'Megaminx', defaultLength: 0 },
  { id: 'pyro', name: 'optimal', group: 'Pyraminx', defaultLength: 0 },
  { id: 'pyrm', name: 'random move', group: 'Pyraminx', defaultLength: 25 },
  { id: 'pyrl4e', name: 'L4E', group: 'Pyraminx', defaultLength: 0 },
  { id: 'pyr4c', name: '4 tips', group: 'Pyraminx', defaultLength: 0 },
  { id: 'pyrnb', name: 'No bar', group: 'Pyraminx', defaultLength: 0 },
  { id: 'skbo', name: 'optimal', group: 'Skewb', defaultLength: 0 },
  { id: 'skb', name: 'random move', group: 'Skewb', defaultLength: 25 },
  { id: 'skbnb', name: 'No bar', group: 'Skewb', defaultLength: 0 },
  { id: 'sqrcsp', name: 'CSP', group: 'Square-1', defaultLength: 0 },
  { id: 'sq1pll', name: 'PLL', group: 'Square-1', defaultLength: 0 },
  { id: 'sq1h', name: 'face turn metric', group: 'Square-1', defaultLength: 40 },
  { id: 'sq1t', name: 'twist metric', group: 'Square-1', defaultLength: 20 },
  { id: 'fto', name: 'random move', group: 'FTO (Face-Turning Octahedron)', defaultLength: 30 },
  { id: 'ftol3t', name: 'L3T', group: 'FTO (Face-Turning Octahedron)', defaultLength: 0 },
  { id: 'ftol4t', name: 'L3T+LBT', group: 'FTO (Face-Turning Octahedron)', defaultLength: 0 },
  { id: 'ftotcp', name: 'TCP', group: 'FTO (Face-Turning Octahedron)', defaultLength: 0 },
  { id: 'ftoedge', name: 'edges only', group: 'FTO (Face-Turning Octahedron)', defaultLength: 0 },
  { id: 'ftocent', name: 'centers only', group: 'FTO (Face-Turning Octahedron)', defaultLength: 0 },
  { id: 'ftocorn', name: 'corners only', group: 'FTO (Face-Turning Octahedron)', defaultLength: 0 },
  { id: 'dmdso', name: 'Diamond random state', group: 'FTO (Face-Turning Octahedron)', defaultLength: 0 },
  { id: '15prp', name: 'random state URLD', group: '15 puzzle', defaultLength: 0 },
  { id: '15prap', name: 'random state ^<>v', group: '15 puzzle', defaultLength: 0 },
  { id: '15prmp', name: 'random state Blank', group: '15 puzzle', defaultLength: 0 },
  { id: '15p', name: 'random move URLD', group: '15 puzzle', defaultLength: 80 },
  { id: '15pat', name: 'random move ^<>v', group: '15 puzzle', defaultLength: 80 },
  { id: '15pm', name: 'random move Blank', group: '15 puzzle', defaultLength: 80 },
  { id: '8prp', name: 'random state URLD', group: '8 puzzle', defaultLength: 0 },
  { id: '8prap', name: 'random state ^<>v', group: '8 puzzle', defaultLength: 0 },
  { id: '8prmp', name: 'random state Blank', group: '8 puzzle', defaultLength: 0 },
  { id: '133', name: '1x3x3 (Floppy Cube)', group: 'LxMxN', defaultLength: 0 },
  { id: '223', name: '2x2x3 (Tower Cube)', group: 'LxMxN', defaultLength: 0 },
  { id: '233', name: '2x3x3 (Domino)', group: 'LxMxN', defaultLength: 25 },
  { id: '334', name: '3x3x4', group: 'LxMxN', defaultLength: 40 },
  { id: '335', name: '3x3x5', group: 'LxMxN', defaultLength: 25 },
  { id: '336', name: '3x3x6', group: 'LxMxN', defaultLength: 40 },
  { id: '337', name: '3x3x7', group: 'LxMxN', defaultLength: 40 },
  { id: '888', name: '8x8x8', group: 'LxMxN', defaultLength: 120 },
  { id: '999', name: '9x9x9', group: 'LxMxN', defaultLength: 120 },
  { id: '101010', name: '10x10x10', group: 'LxMxN', defaultLength: 120 },
  { id: '111111', name: '11x11x11', group: 'LxMxN', defaultLength: 120 },
  { id: 'cubennn', name: 'NxNxN', group: 'LxMxN', defaultLength: 12 },
  { id: 'mrbl', name: 'Mirror Blocks', group: 'LxMxN', defaultLength: 0 },
  { id: 'gearso', name: 'random state', group: 'Gear Cube', defaultLength: 0 },
  { id: 'gearo', name: 'optimal', group: 'Gear Cube', defaultLength: 0 },
  { id: 'gear', name: 'random move', group: 'Gear Cube', defaultLength: 10 },
  { id: 'klmso', name: 'random state', group: 'Kilominx', defaultLength: 0 },
  { id: 'klmp', name: 'Pochmann', group: 'Kilominx', defaultLength: 30 },
  { id: 'giga', name: 'Pochmann', group: 'Gigaminx', defaultLength: 300 },
  { id: 'crz3a', name: 'Crazy 3x3x3', group: 'Crazy Puzzle', defaultLength: 30 },
  { id: 'cm3', name: 'Cmetrick', group: 'Cmetrick', defaultLength: 25 },
  { id: 'cm2', name: 'Cmetrick Mini', group: 'Cmetrick', defaultLength: 25 },
  { id: 'heli', name: 'Heli copter', group: 'Helicopter Cube', defaultLength: 40 },
  { id: 'helicv', name: 'Curvy copter', group: 'Helicopter Cube', defaultLength: 40 },
  { id: 'heli2x2', name: '2x2 Heli random move', group: 'Helicopter Cube', defaultLength: 70 },
  { id: 'heli2x2g', name: '2x2 Heli by group', group: 'Helicopter Cube', defaultLength: 5 },
  { id: 'rediso', name: 'random state', group: 'Redi Cube', defaultLength: 0 },
  { id: 'redim', name: 'MoYu', group: 'Redi Cube', defaultLength: 8 },
  { id: 'redi', name: 'random move', group: 'Redi Cube', defaultLength: 20 },
  { id: 'dinoso', name: 'random state', group: 'Dino Cube', defaultLength: 0 },
  { id: 'dinoo', name: 'optimal', group: 'Dino Cube', defaultLength: 0 },
  { id: 'ivyso', name: 'random state', group: 'Ivy cube', defaultLength: 0 },
  { id: 'ivyo', name: 'optimal', group: 'Ivy cube', defaultLength: 0 },
  { id: 'ivy', name: 'random move', group: 'Ivy cube', defaultLength: 10 },
  { id: 'mpyrso', name: 'random state', group: 'Master Pyraminx', defaultLength: 0 },
  { id: 'mpyr', name: 'random move', group: 'Master Pyraminx', defaultLength: 42 },
  { id: 'prcp', name: 'Pochmann', group: 'Pyraminx Crystal', defaultLength: 70 },
  { id: 'prco', name: 'old style', group: 'Pyraminx Crystal', defaultLength: 70 },
  { id: 'sia113', name: '1x1x3 block', group: 'Siamese Cube', defaultLength: 25 },
  { id: 'sia123', name: '1x2x3 block', group: 'Siamese Cube', defaultLength: 25 },
  { id: 'sia222', name: '2x2x2 block', group: 'Siamese Cube', defaultLength: 25 },
  { id: 'sq2', name: 'Square-2', group: 'Square', defaultLength: 20 },
  { id: 'ssq1t', name: 'Super Square-1', group: 'Square', defaultLength: 20 },
  { id: 'sfl', name: 'sfl', group: 'Super Floppy', defaultLength: 25 },
  { id: 'ufo', name: 'Jaap style', group: 'UFO', defaultLength: 25 },
  { id: 'ctico', name: 'Icosamate random move', group: 'Icosahedron', defaultLength: 60 },
  { id: '2gen', name: '2-generator R,U', group: '3x3x3 subsets', defaultLength: 0 },
  { id: '2genl', name: '2-generator L,U', group: '3x3x3 subsets', defaultLength: 0 },
  { id: 'roux', name: 'Roux-generator M,U', group: '3x3x3 subsets', defaultLength: 0 },
  { id: '3gen_F', name: '3-generator F,R,U', group: '3x3x3 subsets', defaultLength: 0 },
  { id: '3gen_L', name: '3-generator R,U,L', group: '3x3x3 subsets', defaultLength: 0 },
  { id: 'RrU', name: '3-generator R,r,U', group: '3x3x3 subsets', defaultLength: 0 },
  { id: '333drud', name: 'Domino Subgroup', group: '3x3x3 subsets', defaultLength: 0 },
  { id: 'half', name: 'half turns only', group: '3x3x3 subsets', defaultLength: 0 },
  { id: 'lsll', name: 'last slot + last layer (old)', group: '3x3x3 subsets', defaultLength: 15 },
  { id: 'bic', name: 'Bicube', group: 'Bandaged Cube', defaultLength: 30 },
  { id: 'bsq', name: 'Square-1 /,(1,0)', group: 'Bandaged Cube', defaultLength: 25 },
  { id: 'r3', name: 'lots of 3x3x3s', group: 'Relays', defaultLength: 5 },
  { id: 'r234', name: '234 relay', group: 'Relays', defaultLength: 0 },
  { id: 'r2345', name: '2345 relay', group: 'Relays', defaultLength: 0 },
  { id: 'r23456', name: '23456 relay', group: 'Relays', defaultLength: 0 },
  { id: 'r234567', name: '234567 relay', group: 'Relays', defaultLength: 0 },
  { id: 'r234w', name: '234 relay (WCA)', group: 'Relays', defaultLength: 0 },
  { id: 'r2345w', name: '2345 relay (WCA)', group: 'Relays', defaultLength: 0 },
  { id: 'r23456w', name: '23456 relay (WCA)', group: 'Relays', defaultLength: 0 },
  { id: 'r234567w', name: '234567 relay (WCA)', group: 'Relays', defaultLength: 0 },
  { id: 'rmngf', name: 'Mini Guildford', group: 'Relays', defaultLength: 0 },
  { id: '111', name: 'x y z', group: '1x1x1', defaultLength: 25 },
  { id: '-1', name: '-1', group: '-1x-1x-1', defaultLength: 25 },
  { id: '112', name: '112', group: '1x1x2', defaultLength: 25 },
  { id: 'lol', name: 'lol', group: 'LOL', defaultLength: 25 },
  { id: 'eide', name: 'eide', group: 'Derrick Eide', defaultLength: 25 },
]

/**
 * One level-2 entry: a selectable scramble type.
 */
export interface ScrambleChoice {
  id: string
  /** Display name — unique inside its group, so no prefix is needed. */
  label: string
  defaultLength: number
}

/**
 * One level-1 entry: a menu category and what sits under it.
 *
 * csTimer's `scrdata` is exactly this shape — `[category, [[name, id, len]…]]`
 * — and the UI mirrors it with two selectors: category first, then type.
 * Several groups reuse the same name ("PLL" appears under 3x3x3 CFOP and
 * Square-1, "random move" under many cubes), which is fine because a name only
 * ever has to be unambiguous inside its own group.
 */
export interface ScrambleGroup {
  /** Category name, e.g. "WCA" or "3x3x3 CFOP". */
  name: string
  /** Its types, in csTimer's menu order. */
  choices: readonly ScrambleChoice[]
}

function buildGroup(name: string, types: readonly ScrambleType[]): ScrambleGroup {
  return {
    name,
    choices: types.map((type) => ({
      id: type.id,
      label: type.name,
      defaultLength: type.defaultLength,
    })),
  }
}

/**
 * Every category, in csTimer's menu order, with its types beneath it.
 *
 * Groups are taken in order of first appearance in SCRAMBLE_TYPES, which is
 * csTimer's order, so the first selector reads WCA, 3x3x3, 3x3x3 CFOP, …
 */
function buildGroups(types: readonly ScrambleType[]): ScrambleGroup[] {
  const order: string[] = []
  const byGroup = new Map<string, ScrambleType[]>()
  for (const type of types) {
    if (!byGroup.has(type.group)) {
      byGroup.set(type.group, [])
      order.push(type.group)
    }
    byGroup.get(type.group)!.push(type)
  }
  return order.map((name) => buildGroup(name, byGroup.get(name)!))
}

/** The categories the first selector offers, in menu order. */
export const SCRAMBLE_GROUPS: readonly ScrambleGroup[] = buildGroups(SCRAMBLE_TYPES)

const GROUP_BY_TYPE = new Map(SCRAMBLE_TYPES.map((type) => [type.id, type.group]))

/** Category a type belongs to, or undefined for an unknown id. */
export function groupOfScrambleType(id: string): string | undefined {
  return GROUP_BY_TYPE.get(id)
}

const LENGTH_BY_ID = new Map(SCRAMBLE_TYPES.map((type) => [type.id, type.defaultLength]))

/** Length to pass to getScramble() for `id`; 0 for an id we don't know. */
export function scrambleLength(id: string): number {
  return LENGTH_BY_ID.get(id) ?? 0
}
