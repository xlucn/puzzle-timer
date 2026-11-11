//! The catalogue of scramble types csTimer offers.
//!
//! Pure data: no `cstimer_module` import, no GTK. The ids and default lengths
//! are what the scrambler needs at generation time; keeping them here means
//! the selector builds synchronously (no async startup) and the table itself
//! can be unit-tested without a worker or a display.
//!
//! Source of the data: csTimer's menu definition `scrdata` in
//! `src/lang/en-us.js` (GPL-3.0, © Shuang Chen and contributors) — the display
//! names, the menu groups and the length csTimer passes to the scrambler.
//! Only that data was taken, no code; csTimer and `cstimer_module` are
//! credited in the About dialog.
//!
//!   - `id` is what cstimer_module's getScramble(type, length) expects.
//!   - `default_length` is |len| from csTimer's menu entry. csTimer shows the
//!     absolute value in its length field and passes exactly that, so -40 for
//!     444wca becomes 40. The length matters: random-move scramblers need a
//!     positive one (getScramble("555wca", 0) returns ""), while random-state
//!     ones want 0 (getScramble("333", 25) would be the wrong generator).
//!   - `2226` is not in csTimer's menu at all: it is cstimer_module's 2x2
//!     6-gen scrambler, the counterpart of csTimer's `2223` "3-gen", so it
//!     gets the same default length.
//!
//! All 206 ids match cstimer_module v0.1.5's getScrambleTypes(); the
//! `scramble_sweep` binary generates one scramble of every type.

/// One entry of the catalogue.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScrambleType {
    /// Id understood by cstimer_module.
    pub id: &'static str,
    /// Display name, e.g. "3x3x3". Stays English in every locale.
    pub name: &'static str,
    /// csTimer menu group, e.g. "WCA" or "3x3x3 CFOP".
    pub group: &'static str,
    /// Length argument for getScramble(); see the module note.
    pub default_length: u32,
}

/// Type the app opens with — also csTimer's default.
pub const SCRAMBLE_DEFAULT_TYPE: &str = "333";

/// Every type, in csTimer's menu order.
pub const SCRAMBLE_TYPES: [ScrambleType; 206] = [
    ScrambleType {
        id: "333",
        name: "3x3x3",
        group: "WCA",
        default_length: 0,
    },
    ScrambleType {
        id: "222so",
        name: "2x2x2",
        group: "WCA",
        default_length: 0,
    },
    ScrambleType {
        id: "444wca",
        name: "4x4x4",
        group: "WCA",
        default_length: 40,
    },
    ScrambleType {
        id: "555wca",
        name: "5x5x5",
        group: "WCA",
        default_length: 60,
    },
    ScrambleType {
        id: "666wca",
        name: "6x6x6",
        group: "WCA",
        default_length: 80,
    },
    ScrambleType {
        id: "777wca",
        name: "7x7x7",
        group: "WCA",
        default_length: 100,
    },
    ScrambleType {
        id: "333ni",
        name: "3x3 bld",
        group: "WCA",
        default_length: 0,
    },
    ScrambleType {
        id: "333fm",
        name: "3x3 fm",
        group: "WCA",
        default_length: 0,
    },
    ScrambleType {
        id: "333oh",
        name: "3x3 oh",
        group: "WCA",
        default_length: 0,
    },
    ScrambleType {
        id: "clkwca",
        name: "clock",
        group: "WCA",
        default_length: 0,
    },
    ScrambleType {
        id: "mgmp",
        name: "megaminx",
        group: "WCA",
        default_length: 70,
    },
    ScrambleType {
        id: "pyrso",
        name: "pyraminx",
        group: "WCA",
        default_length: 10,
    },
    ScrambleType {
        id: "skbso",
        name: "skewb",
        group: "WCA",
        default_length: 0,
    },
    ScrambleType {
        id: "ftoso",
        name: "FTO",
        group: "WCA",
        default_length: 0,
    },
    ScrambleType {
        id: "sqrs",
        name: "sq1",
        group: "WCA",
        default_length: 0,
    },
    ScrambleType {
        id: "444bld",
        name: "4x4 bld",
        group: "WCA",
        default_length: 40,
    },
    ScrambleType {
        id: "555bld",
        name: "5x5 bld",
        group: "WCA",
        default_length: 60,
    },
    ScrambleType {
        id: "r3ni",
        name: "3x3 mbld",
        group: "WCA",
        default_length: 5,
    },
    ScrambleType {
        id: "blank",
        name: "--",
        group: "WCA",
        default_length: 0,
    },
    ScrambleType {
        id: "333o",
        name: "random move",
        group: "3x3x3",
        default_length: 25,
    },
    ScrambleType {
        id: "333noob",
        name: "3x3x3 for noobs",
        group: "3x3x3",
        default_length: 25,
    },
    ScrambleType {
        id: "edges",
        name: "edges only",
        group: "3x3x3",
        default_length: 0,
    },
    ScrambleType {
        id: "corners",
        name: "corners only",
        group: "3x3x3",
        default_length: 0,
    },
    ScrambleType {
        id: "333ft",
        name: "3x3 ft",
        group: "3x3x3",
        default_length: 0,
    },
    ScrambleType {
        id: "333custom",
        name: "Custom",
        group: "3x3x3",
        default_length: 0,
    },
    ScrambleType {
        id: "pll",
        name: "PLL",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "oll",
        name: "OLL",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "lsll2",
        name: "last slot + last layer",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "ll",
        name: "last layer",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "zbll",
        name: "ZBLL",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "coll",
        name: "COLL",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "cll",
        name: "CLL",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "ell",
        name: "ELL",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "2gll",
        name: "2GLL",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "zzll",
        name: "ZZLL",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "zbls",
        name: "ZBLS",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "eols",
        name: "EOLS",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "wvls",
        name: "WVLS",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "vls",
        name: "VLS",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "f2l",
        name: "cross solved",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "eoline",
        name: "EOLine",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "eocross",
        name: "EO Cross",
        group: "3x3x3 CFOP",
        default_length: 0,
    },
    ScrambleType {
        id: "easyc",
        name: "easy cross",
        group: "3x3x3 CFOP",
        default_length: 3,
    },
    ScrambleType {
        id: "easyxc",
        name: "easy xcross",
        group: "3x3x3 CFOP",
        default_length: 4,
    },
    ScrambleType {
        id: "sbrx",
        name: "2nd Block",
        group: "3x3x3 Roux",
        default_length: 0,
    },
    ScrambleType {
        id: "cmll",
        name: "CMLL",
        group: "3x3x3 Roux",
        default_length: 0,
    },
    ScrambleType {
        id: "lse",
        name: "LSE",
        group: "3x3x3 Roux",
        default_length: 0,
    },
    ScrambleType {
        id: "lsemu",
        name: "LSE <M, U>",
        group: "3x3x3 Roux",
        default_length: 0,
    },
    ScrambleType {
        id: "mt3qb",
        name: "3QB",
        group: "3x3x3 Mehta",
        default_length: 0,
    },
    ScrambleType {
        id: "mteole",
        name: "EOLE",
        group: "3x3x3 Mehta",
        default_length: 0,
    },
    ScrambleType {
        id: "mttdr",
        name: "TDR",
        group: "3x3x3 Mehta",
        default_length: 0,
    },
    ScrambleType {
        id: "mt6cp",
        name: "6CP",
        group: "3x3x3 Mehta",
        default_length: 0,
    },
    ScrambleType {
        id: "mtcdrll",
        name: "CDRLL",
        group: "3x3x3 Mehta",
        default_length: 0,
    },
    ScrambleType {
        id: "mtl5ep",
        name: "L5EP",
        group: "3x3x3 Mehta",
        default_length: 0,
    },
    ScrambleType {
        id: "ttll",
        name: "TTLL",
        group: "3x3x3 Mehta",
        default_length: 0,
    },
    ScrambleType {
        id: "222o",
        name: "optimal",
        group: "2x2x2",
        default_length: 0,
    },
    ScrambleType {
        id: "2223",
        name: "3-gen",
        group: "2x2x2",
        default_length: 25,
    },
    ScrambleType {
        id: "2226",
        name: "6-gen",
        group: "2x2x2",
        default_length: 25,
    },
    ScrambleType {
        id: "222eg",
        name: "EG",
        group: "2x2x2",
        default_length: 0,
    },
    ScrambleType {
        id: "222eg0",
        name: "CLL",
        group: "2x2x2",
        default_length: 0,
    },
    ScrambleType {
        id: "222eg1",
        name: "EG1",
        group: "2x2x2",
        default_length: 0,
    },
    ScrambleType {
        id: "222eg2",
        name: "EG2",
        group: "2x2x2",
        default_length: 0,
    },
    ScrambleType {
        id: "222tcp",
        name: "TCLL+",
        group: "2x2x2",
        default_length: 0,
    },
    ScrambleType {
        id: "222tcn",
        name: "TCLL-",
        group: "2x2x2",
        default_length: 0,
    },
    ScrambleType {
        id: "222tc",
        name: "TCLL",
        group: "2x2x2",
        default_length: 0,
    },
    ScrambleType {
        id: "222lsall",
        name: "LS",
        group: "2x2x2",
        default_length: 0,
    },
    ScrambleType {
        id: "222nb",
        name: "No Bar",
        group: "2x2x2",
        default_length: 0,
    },
    ScrambleType {
        id: "444m",
        name: "random move",
        group: "4x4x4",
        default_length: 40,
    },
    ScrambleType {
        id: "444",
        name: "SiGN",
        group: "4x4x4",
        default_length: 40,
    },
    ScrambleType {
        id: "444yj",
        name: "YJ",
        group: "4x4x4",
        default_length: 40,
    },
    ScrambleType {
        id: "4edge",
        name: "4x4x4 edges",
        group: "4x4x4",
        default_length: 0,
    },
    ScrambleType {
        id: "RrUu",
        name: "R,r,U,u",
        group: "4x4x4",
        default_length: 40,
    },
    ScrambleType {
        id: "444ll",
        name: "Last layer",
        group: "4x4x4",
        default_length: 0,
    },
    ScrambleType {
        id: "444ell",
        name: "ELL",
        group: "4x4x4",
        default_length: 0,
    },
    ScrambleType {
        id: "444edo",
        name: "Edge only",
        group: "4x4x4",
        default_length: 0,
    },
    ScrambleType {
        id: "444cto",
        name: "Center only",
        group: "4x4x4",
        default_length: 0,
    },
    ScrambleType {
        id: "444ctud",
        name: "UD center solved",
        group: "4x4x4 Yau/Hoya",
        default_length: 0,
    },
    ScrambleType {
        id: "444ud3c",
        name: "UD+3E solved",
        group: "4x4x4 Yau/Hoya",
        default_length: 0,
    },
    ScrambleType {
        id: "444l8e",
        name: "Last 8 dedges",
        group: "4x4x4 Yau/Hoya",
        default_length: 0,
    },
    ScrambleType {
        id: "444ctrl",
        name: "RL center solved",
        group: "4x4x4 Yau/Hoya",
        default_length: 0,
    },
    ScrambleType {
        id: "444rlda",
        name: "RLDX center solved",
        group: "4x4x4 Yau/Hoya",
        default_length: 0,
    },
    ScrambleType {
        id: "444rlca",
        name: "RLDX cross solved",
        group: "4x4x4 Yau/Hoya",
        default_length: 0,
    },
    ScrambleType {
        id: "555",
        name: "SiGN",
        group: "5x5x5",
        default_length: 60,
    },
    ScrambleType {
        id: "5edge",
        name: "5x5x5 edges",
        group: "5x5x5",
        default_length: 8,
    },
    ScrambleType {
        id: "666si",
        name: "SiGN",
        group: "6x6x6",
        default_length: 80,
    },
    ScrambleType {
        id: "666p",
        name: "prefix",
        group: "6x6x6",
        default_length: 80,
    },
    ScrambleType {
        id: "666s",
        name: "suffix",
        group: "6x6x6",
        default_length: 80,
    },
    ScrambleType {
        id: "6edge",
        name: "6x6x6 edges",
        group: "6x6x6",
        default_length: 8,
    },
    ScrambleType {
        id: "777si",
        name: "SiGN",
        group: "7x7x7",
        default_length: 100,
    },
    ScrambleType {
        id: "777p",
        name: "prefix",
        group: "7x7x7",
        default_length: 100,
    },
    ScrambleType {
        id: "777s",
        name: "suffix",
        group: "7x7x7",
        default_length: 100,
    },
    ScrambleType {
        id: "7edge",
        name: "7x7x7 edges",
        group: "7x7x7",
        default_length: 8,
    },
    ScrambleType {
        id: "clkwcab",
        name: "wca (old)",
        group: "Clock",
        default_length: 0,
    },
    ScrambleType {
        id: "clknf",
        name: "WCA w/o y2",
        group: "Clock",
        default_length: 0,
    },
    ScrambleType {
        id: "clk",
        name: "jaap",
        group: "Clock",
        default_length: 0,
    },
    ScrambleType {
        id: "clko",
        name: "optimal",
        group: "Clock",
        default_length: 0,
    },
    ScrambleType {
        id: "clkc",
        name: "concise",
        group: "Clock",
        default_length: 0,
    },
    ScrambleType {
        id: "clke",
        name: "efficient pin order",
        group: "Clock",
        default_length: 0,
    },
    ScrambleType {
        id: "mgmc",
        name: "Carrot",
        group: "Megaminx",
        default_length: 70,
    },
    ScrambleType {
        id: "mgmo",
        name: "old style",
        group: "Megaminx",
        default_length: 70,
    },
    ScrambleType {
        id: "minx2g",
        name: "2-generator R,U",
        group: "Megaminx",
        default_length: 30,
    },
    ScrambleType {
        id: "mlsll",
        name: "last slot + last layer",
        group: "Megaminx",
        default_length: 0,
    },
    ScrambleType {
        id: "mgmso",
        name: "random state",
        group: "Megaminx",
        default_length: 0,
    },
    ScrambleType {
        id: "mgmpll",
        name: "PLL",
        group: "Megaminx",
        default_length: 0,
    },
    ScrambleType {
        id: "mgmll",
        name: "Last Layer",
        group: "Megaminx",
        default_length: 0,
    },
    ScrambleType {
        id: "pyro",
        name: "optimal",
        group: "Pyraminx",
        default_length: 0,
    },
    ScrambleType {
        id: "pyrm",
        name: "random move",
        group: "Pyraminx",
        default_length: 25,
    },
    ScrambleType {
        id: "pyrl4e",
        name: "L4E",
        group: "Pyraminx",
        default_length: 0,
    },
    ScrambleType {
        id: "pyr4c",
        name: "4 tips",
        group: "Pyraminx",
        default_length: 0,
    },
    ScrambleType {
        id: "pyrnb",
        name: "No bar",
        group: "Pyraminx",
        default_length: 0,
    },
    ScrambleType {
        id: "skbo",
        name: "optimal",
        group: "Skewb",
        default_length: 0,
    },
    ScrambleType {
        id: "skb",
        name: "random move",
        group: "Skewb",
        default_length: 25,
    },
    ScrambleType {
        id: "skbnb",
        name: "No bar",
        group: "Skewb",
        default_length: 0,
    },
    ScrambleType {
        id: "sqrcsp",
        name: "CSP",
        group: "Square-1",
        default_length: 0,
    },
    ScrambleType {
        id: "sq1pll",
        name: "PLL",
        group: "Square-1",
        default_length: 0,
    },
    ScrambleType {
        id: "sq1h",
        name: "face turn metric",
        group: "Square-1",
        default_length: 40,
    },
    ScrambleType {
        id: "sq1t",
        name: "twist metric",
        group: "Square-1",
        default_length: 20,
    },
    ScrambleType {
        id: "fto",
        name: "random move",
        group: "FTO (Face-Turning Octahedron)",
        default_length: 30,
    },
    ScrambleType {
        id: "ftol3t",
        name: "L3T",
        group: "FTO (Face-Turning Octahedron)",
        default_length: 0,
    },
    ScrambleType {
        id: "ftol4t",
        name: "L3T+LBT",
        group: "FTO (Face-Turning Octahedron)",
        default_length: 0,
    },
    ScrambleType {
        id: "ftotcp",
        name: "TCP",
        group: "FTO (Face-Turning Octahedron)",
        default_length: 0,
    },
    ScrambleType {
        id: "ftoedge",
        name: "edges only",
        group: "FTO (Face-Turning Octahedron)",
        default_length: 0,
    },
    ScrambleType {
        id: "ftocent",
        name: "centers only",
        group: "FTO (Face-Turning Octahedron)",
        default_length: 0,
    },
    ScrambleType {
        id: "ftocorn",
        name: "corners only",
        group: "FTO (Face-Turning Octahedron)",
        default_length: 0,
    },
    ScrambleType {
        id: "dmdso",
        name: "Diamond random state",
        group: "FTO (Face-Turning Octahedron)",
        default_length: 0,
    },
    ScrambleType {
        id: "15prp",
        name: "random state URLD",
        group: "15 puzzle",
        default_length: 0,
    },
    ScrambleType {
        id: "15prap",
        name: "random state ^<>v",
        group: "15 puzzle",
        default_length: 0,
    },
    ScrambleType {
        id: "15prmp",
        name: "random state Blank",
        group: "15 puzzle",
        default_length: 0,
    },
    ScrambleType {
        id: "15p",
        name: "random move URLD",
        group: "15 puzzle",
        default_length: 80,
    },
    ScrambleType {
        id: "15pat",
        name: "random move ^<>v",
        group: "15 puzzle",
        default_length: 80,
    },
    ScrambleType {
        id: "15pm",
        name: "random move Blank",
        group: "15 puzzle",
        default_length: 80,
    },
    ScrambleType {
        id: "8prp",
        name: "random state URLD",
        group: "8 puzzle",
        default_length: 0,
    },
    ScrambleType {
        id: "8prap",
        name: "random state ^<>v",
        group: "8 puzzle",
        default_length: 0,
    },
    ScrambleType {
        id: "8prmp",
        name: "random state Blank",
        group: "8 puzzle",
        default_length: 0,
    },
    ScrambleType {
        id: "133",
        name: "1x3x3 (Floppy Cube)",
        group: "LxMxN",
        default_length: 0,
    },
    ScrambleType {
        id: "223",
        name: "2x2x3 (Tower Cube)",
        group: "LxMxN",
        default_length: 0,
    },
    ScrambleType {
        id: "233",
        name: "2x3x3 (Domino)",
        group: "LxMxN",
        default_length: 25,
    },
    ScrambleType {
        id: "334",
        name: "3x3x4",
        group: "LxMxN",
        default_length: 40,
    },
    ScrambleType {
        id: "335",
        name: "3x3x5",
        group: "LxMxN",
        default_length: 25,
    },
    ScrambleType {
        id: "336",
        name: "3x3x6",
        group: "LxMxN",
        default_length: 40,
    },
    ScrambleType {
        id: "337",
        name: "3x3x7",
        group: "LxMxN",
        default_length: 40,
    },
    ScrambleType {
        id: "888",
        name: "8x8x8",
        group: "LxMxN",
        default_length: 120,
    },
    ScrambleType {
        id: "999",
        name: "9x9x9",
        group: "LxMxN",
        default_length: 120,
    },
    ScrambleType {
        id: "101010",
        name: "10x10x10",
        group: "LxMxN",
        default_length: 120,
    },
    ScrambleType {
        id: "111111",
        name: "11x11x11",
        group: "LxMxN",
        default_length: 120,
    },
    ScrambleType {
        id: "cubennn",
        name: "NxNxN",
        group: "LxMxN",
        default_length: 12,
    },
    ScrambleType {
        id: "mrbl",
        name: "Mirror Blocks",
        group: "LxMxN",
        default_length: 0,
    },
    ScrambleType {
        id: "gearso",
        name: "random state",
        group: "Gear Cube",
        default_length: 0,
    },
    ScrambleType {
        id: "gearo",
        name: "optimal",
        group: "Gear Cube",
        default_length: 0,
    },
    ScrambleType {
        id: "gear",
        name: "random move",
        group: "Gear Cube",
        default_length: 10,
    },
    ScrambleType {
        id: "klmso",
        name: "random state",
        group: "Kilominx",
        default_length: 0,
    },
    ScrambleType {
        id: "klmp",
        name: "Pochmann",
        group: "Kilominx",
        default_length: 30,
    },
    ScrambleType {
        id: "giga",
        name: "Pochmann",
        group: "Gigaminx",
        default_length: 300,
    },
    ScrambleType {
        id: "crz3a",
        name: "Crazy 3x3x3",
        group: "Crazy Puzzle",
        default_length: 30,
    },
    ScrambleType {
        id: "cm3",
        name: "Cmetrick",
        group: "Cmetrick",
        default_length: 25,
    },
    ScrambleType {
        id: "cm2",
        name: "Cmetrick Mini",
        group: "Cmetrick",
        default_length: 25,
    },
    ScrambleType {
        id: "heli",
        name: "Heli copter",
        group: "Helicopter Cube",
        default_length: 40,
    },
    ScrambleType {
        id: "helicv",
        name: "Curvy copter",
        group: "Helicopter Cube",
        default_length: 40,
    },
    ScrambleType {
        id: "heli2x2",
        name: "2x2 Heli random move",
        group: "Helicopter Cube",
        default_length: 70,
    },
    ScrambleType {
        id: "heli2x2g",
        name: "2x2 Heli by group",
        group: "Helicopter Cube",
        default_length: 5,
    },
    ScrambleType {
        id: "rediso",
        name: "random state",
        group: "Redi Cube",
        default_length: 0,
    },
    ScrambleType {
        id: "redim",
        name: "MoYu",
        group: "Redi Cube",
        default_length: 8,
    },
    ScrambleType {
        id: "redi",
        name: "random move",
        group: "Redi Cube",
        default_length: 20,
    },
    ScrambleType {
        id: "dinoso",
        name: "random state",
        group: "Dino Cube",
        default_length: 0,
    },
    ScrambleType {
        id: "dinoo",
        name: "optimal",
        group: "Dino Cube",
        default_length: 0,
    },
    ScrambleType {
        id: "ivyso",
        name: "random state",
        group: "Ivy cube",
        default_length: 0,
    },
    ScrambleType {
        id: "ivyo",
        name: "optimal",
        group: "Ivy cube",
        default_length: 0,
    },
    ScrambleType {
        id: "ivy",
        name: "random move",
        group: "Ivy cube",
        default_length: 10,
    },
    ScrambleType {
        id: "mpyrso",
        name: "random state",
        group: "Master Pyraminx",
        default_length: 0,
    },
    ScrambleType {
        id: "mpyr",
        name: "random move",
        group: "Master Pyraminx",
        default_length: 42,
    },
    ScrambleType {
        id: "prcp",
        name: "Pochmann",
        group: "Pyraminx Crystal",
        default_length: 70,
    },
    ScrambleType {
        id: "prco",
        name: "old style",
        group: "Pyraminx Crystal",
        default_length: 70,
    },
    ScrambleType {
        id: "sia113",
        name: "1x1x3 block",
        group: "Siamese Cube",
        default_length: 25,
    },
    ScrambleType {
        id: "sia123",
        name: "1x2x3 block",
        group: "Siamese Cube",
        default_length: 25,
    },
    ScrambleType {
        id: "sia222",
        name: "2x2x2 block",
        group: "Siamese Cube",
        default_length: 25,
    },
    ScrambleType {
        id: "sq2",
        name: "Square-2",
        group: "Square",
        default_length: 20,
    },
    ScrambleType {
        id: "ssq1t",
        name: "Super Square-1",
        group: "Square",
        default_length: 20,
    },
    ScrambleType {
        id: "sfl",
        name: "sfl",
        group: "Super Floppy",
        default_length: 25,
    },
    ScrambleType {
        id: "ufo",
        name: "Jaap style",
        group: "UFO",
        default_length: 25,
    },
    ScrambleType {
        id: "ctico",
        name: "Icosamate random move",
        group: "Icosahedron",
        default_length: 60,
    },
    ScrambleType {
        id: "2gen",
        name: "2-generator R,U",
        group: "3x3x3 subsets",
        default_length: 0,
    },
    ScrambleType {
        id: "2genl",
        name: "2-generator L,U",
        group: "3x3x3 subsets",
        default_length: 0,
    },
    ScrambleType {
        id: "roux",
        name: "Roux-generator M,U",
        group: "3x3x3 subsets",
        default_length: 0,
    },
    ScrambleType {
        id: "3gen_F",
        name: "3-generator F,R,U",
        group: "3x3x3 subsets",
        default_length: 0,
    },
    ScrambleType {
        id: "3gen_L",
        name: "3-generator R,U,L",
        group: "3x3x3 subsets",
        default_length: 0,
    },
    ScrambleType {
        id: "RrU",
        name: "3-generator R,r,U",
        group: "3x3x3 subsets",
        default_length: 0,
    },
    ScrambleType {
        id: "333drud",
        name: "Domino Subgroup",
        group: "3x3x3 subsets",
        default_length: 0,
    },
    ScrambleType {
        id: "half",
        name: "half turns only",
        group: "3x3x3 subsets",
        default_length: 0,
    },
    ScrambleType {
        id: "lsll",
        name: "last slot + last layer (old)",
        group: "3x3x3 subsets",
        default_length: 15,
    },
    ScrambleType {
        id: "bic",
        name: "Bicube",
        group: "Bandaged Cube",
        default_length: 30,
    },
    ScrambleType {
        id: "bsq",
        name: "Square-1 /,(1,0)",
        group: "Bandaged Cube",
        default_length: 25,
    },
    ScrambleType {
        id: "r3",
        name: "lots of 3x3x3s",
        group: "Relays",
        default_length: 5,
    },
    ScrambleType {
        id: "r234",
        name: "234 relay",
        group: "Relays",
        default_length: 0,
    },
    ScrambleType {
        id: "r2345",
        name: "2345 relay",
        group: "Relays",
        default_length: 0,
    },
    ScrambleType {
        id: "r23456",
        name: "23456 relay",
        group: "Relays",
        default_length: 0,
    },
    ScrambleType {
        id: "r234567",
        name: "234567 relay",
        group: "Relays",
        default_length: 0,
    },
    ScrambleType {
        id: "r234w",
        name: "234 relay (WCA)",
        group: "Relays",
        default_length: 0,
    },
    ScrambleType {
        id: "r2345w",
        name: "2345 relay (WCA)",
        group: "Relays",
        default_length: 0,
    },
    ScrambleType {
        id: "r23456w",
        name: "23456 relay (WCA)",
        group: "Relays",
        default_length: 0,
    },
    ScrambleType {
        id: "r234567w",
        name: "234567 relay (WCA)",
        group: "Relays",
        default_length: 0,
    },
    ScrambleType {
        id: "rmngf",
        name: "Mini Guildford",
        group: "Relays",
        default_length: 0,
    },
    ScrambleType {
        id: "111",
        name: "x y z",
        group: "1x1x1",
        default_length: 25,
    },
    ScrambleType {
        id: "-1",
        name: "-1",
        group: "-1x-1x-1",
        default_length: 25,
    },
    ScrambleType {
        id: "112",
        name: "112",
        group: "1x1x2",
        default_length: 25,
    },
    ScrambleType {
        id: "lol",
        name: "lol",
        group: "LOL",
        default_length: 25,
    },
    ScrambleType {
        id: "eide",
        name: "eide",
        group: "Derrick Eide",
        default_length: 25,
    },
];

/// The catalogue entry for `id`, if it is one of ours.
pub fn scramble_type(id: &str) -> Option<&'static ScrambleType> {
    SCRAMBLE_TYPES.iter().find(|entry| entry.id == id)
}

/// Whether `id` names a type in this catalogue (a hand-edited file's guard).
pub fn is_scramble_type(id: &str) -> bool {
    scramble_type(id).is_some()
}

/// Length to pass to getScramble() for `id`; 0 for an id we don't know.
pub fn scramble_length(id: &str) -> u32 {
    scramble_type(id).map_or(0, |entry| entry.default_length)
}

/// Category a type belongs to, or `None` for an unknown id.
pub fn group_of_scramble_type(id: &str) -> Option<&'static str> {
    scramble_type(id).map(|entry| entry.group)
}

/// Both levels of the menu on one line: `Category - type`.
///
/// The canonical single-line rendering of a type's name: the header's split
/// form ([`scramble_type_title`], the two lines of an `Adw.WindowTitle`) is
/// unit-tested to reassemble into exactly this, and the picker's rows show
/// bare names. A name is only unique inside its group, so the group is not
/// decoration.
///
/// An unknown id (a hand-edited session index) comes back verbatim.
pub fn scramble_type_label(id: &str) -> String {
    match scramble_type(id) {
        Some(entry) => format!("{} - {}", entry.group, entry.name),
        None => id.to_string(),
    }
}

/// The same two levels as separate lines for `Adw.WindowTitle`: category over
/// type name. Reassembling with `" - "` reproduces [`scramble_type_label`] for
/// every id. An unknown id comes back as the category with an empty name;
/// `Adw.WindowTitle` hides an empty subtitle natively, so the verbatim id
/// still shows, alone on one line.
pub fn scramble_type_title(id: &str) -> (String, String) {
    match scramble_type(id) {
        Some(entry) => (entry.group.to_string(), entry.name.to_string()),
        None => (id.to_string(), String::new()),
    }
}

/// The random-move stand-in for a type whose own scramble runs a solver, or
/// `None` when it has none. csTimer's "fast" option swaps it in: 4x4x4
/// random-state takes about a second, the random-move list is instant, and
/// both are 40 moves. The chosen type stays what the session and the header
/// show — only the generator changes.
pub fn fast_scramble_type(id: &str) -> Option<&'static str> {
    (id == "444wca").then_some("444m")
}

/// What the length argument counts for `id`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScrambleLengthKind {
    /// Random moves — the common reading.
    Moves,
    /// Multi-blind: the number of scrambles.
    Scrambles,
    /// "Lots of 3x3x3s": the number of cubes.
    Cubes,
}

/// The label the UI puts on the length spinner for `id`.
pub fn scramble_length_kind(id: &str) -> ScrambleLengthKind {
    match id {
        "r3ni" => ScrambleLengthKind::Scrambles,
        "r3" => ScrambleLengthKind::Cubes,
        _ => ScrambleLengthKind::Moves,
    }
}

/// One type as the selector shows it beneath its category.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScrambleChoice {
    pub id: &'static str,
    pub label: &'static str,
    pub default_length: u32,
}

/// Every category, in csTimer's menu order, with its types beneath it.
///
/// Groups are taken in order of first appearance, which is csTimer's order, so
/// the first selector reads WCA, 3x3x3, 3x3x3 CFOP, …
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScrambleGroup {
    pub name: &'static str,
    pub choices: Vec<ScrambleChoice>,
}

pub fn scramble_groups() -> Vec<ScrambleGroup> {
    let mut groups: Vec<ScrambleGroup> = Vec::new();
    for entry in SCRAMBLE_TYPES {
        match groups.iter_mut().find(|group| group.name == entry.group) {
            Some(group) => group.choices.push(ScrambleChoice {
                id: entry.id,
                label: entry.name,
                default_length: entry.default_length,
            }),
            None => groups.push(ScrambleGroup {
                name: entry.group,
                choices: vec![ScrambleChoice {
                    id: entry.id,
                    label: entry.name,
                    default_length: entry.default_length,
                }],
            }),
        }
    }
    groups
}

/// One higher class of categories — csTimer's disabled `===X===` header rows
/// in `scrdata`, rendered as an `Adw.SidebarSection` with a separator.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScrambleSection {
    /// Class title, e.g. "WCA" or "Jokes".
    pub name: &'static str,
    /// Its groups, in menu order.
    pub groups: Vec<ScrambleGroup>,
}

/// `[class title, first group of the class]` — boundaries at the headers.
const SECTION_STARTS: [(&str, &str); 4] = [
    ("WCA", "WCA"),
    ("Other", "15 puzzle"),
    ("Special", "3x3x3 subsets"),
    ("Jokes", "1x1x1"),
];

/// The higher classes, in menu order; partitions [`scramble_groups`].
pub fn scramble_sections() -> Vec<ScrambleSection> {
    let all = scramble_groups();
    let starts: Vec<(&str, usize)> = SECTION_STARTS
        .iter()
        .filter_map(|(name, first)| {
            let at = all.iter().position(|group| group.name == *first)?;
            Some((*name, at))
        })
        .collect();
    let mut sections = Vec::with_capacity(starts.len());
    for (index, (name, at)) in starts.iter().enumerate() {
        let end = starts.get(index + 1).map_or(all.len(), |(_, next)| *next);
        sections.push(ScrambleSection {
            name,
            groups: all[*at..end].to_vec(),
        });
    }
    sections
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The 206 ids cstimer_module v0.1.5 reports from getScrambleTypes().
    const CSTIMER_MODULE_TYPE_COUNT: usize = 206;

    #[test]
    fn offers_every_type_cstimer_module_provides() {
        assert_eq!(SCRAMBLE_TYPES.len(), CSTIMER_MODULE_TYPE_COUNT);
        let unique: std::collections::HashSet<&str> =
            SCRAMBLE_TYPES.iter().map(|entry| entry.id).collect();
        assert_eq!(unique.len(), CSTIMER_MODULE_TYPE_COUNT);
    }

    #[test]
    fn starts_on_the_3x3_random_state_scramble_like_cstimer() {
        assert_eq!(SCRAMBLE_DEFAULT_TYPE, "333");
        assert!(is_scramble_type(SCRAMBLE_DEFAULT_TYPE));
    }

    #[test]
    fn gives_every_type_a_name_a_group_and_a_usable_length() {
        for entry in SCRAMBLE_TYPES {
            assert!(!entry.id.is_empty(), "id");
            assert!(!entry.name.trim().is_empty(), "{} name", entry.id);
            assert!(!entry.group.trim().is_empty(), "{} group", entry.id);
        }
    }

    #[test]
    fn uses_the_lengths_cstimer_passes_to_the_scrambler() {
        assert_eq!(scramble_length("333"), 0);
        assert_eq!(scramble_length("222so"), 0);
        assert_eq!(scramble_length("444wca"), 40); // csTimer's menu stores -40
        assert_eq!(scramble_length("555wca"), 60);
        assert_eq!(scramble_length("777wca"), 100);
        assert_eq!(scramble_length("333o"), 25);
        assert_eq!(scramble_length("r3ni"), 5); // five cubes for multi-blind
        assert_eq!(scramble_length("no-such-type"), 0);
    }

    #[test]
    fn knows_which_types_have_a_fast_random_move_stand_in() {
        assert_eq!(fast_scramble_type("444wca"), Some("444m"));
        assert_eq!(
            scramble_length(fast_scramble_type("444wca").unwrap_or("")),
            scramble_length("444wca")
        );
        assert_eq!(fast_scramble_type("555wca"), None);
        assert_eq!(fast_scramble_type("333"), None);
        assert_eq!(fast_scramble_type("no-such-type"), None);
    }

    #[test]
    fn knows_when_the_length_counts_scrambles_rather_than_moves() {
        assert_eq!(scramble_length_kind("333o"), ScrambleLengthKind::Moves);
        assert_eq!(scramble_length_kind("444wca"), ScrambleLengthKind::Moves);
        assert_eq!(scramble_length_kind("easyc"), ScrambleLengthKind::Moves);
        assert_eq!(scramble_length_kind("r3ni"), ScrambleLengthKind::Scrambles);
        assert_eq!(scramble_length_kind("r3"), ScrambleLengthKind::Cubes);
        assert_eq!(
            scramble_length_kind("no-such-type"),
            ScrambleLengthKind::Moves
        );
    }

    #[test]
    fn builds_the_two_selector_levels_cstimer_uses() {
        let groups = scramble_groups();
        assert_eq!(groups[0].name, "WCA");
        let expected: Vec<&str> = {
            let mut seen = std::collections::HashSet::new();
            SCRAMBLE_TYPES
                .iter()
                .filter(|entry| seen.insert(entry.group))
                .map(|entry| entry.group)
                .collect()
        };
        let names: Vec<&str> = groups.iter().map(|group| group.name).collect();
        assert_eq!(names, expected);

        let flat: Vec<&str> = groups
            .iter()
            .flat_map(|group| group.choices.iter().map(|choice| choice.id))
            .collect();
        let ids: Vec<&str> = SCRAMBLE_TYPES.iter().map(|entry| entry.id).collect();
        assert_eq!(flat, ids);
        assert_eq!(
            flat.len(),
            flat.iter().collect::<std::collections::HashSet<_>>().len()
        );
    }

    #[test]
    fn partitions_the_categories_into_cstimer_s_four_higher_classes() {
        let sections = scramble_sections();
        let names: Vec<&str> = sections.iter().map(|section| section.name).collect();
        assert_eq!(names, vec!["WCA", "Other", "Special", "Jokes"]);

        let flat: Vec<ScrambleGroup> = sections
            .iter()
            .flat_map(|section| section.groups.clone())
            .collect();
        assert_eq!(flat, scramble_groups());

        assert_eq!(
            sections[0].groups.last().map(|group| group.name),
            Some("FTO (Face-Turning Octahedron)")
        );
        assert_eq!(sections[1].groups[0].name, "15 puzzle");
        let special: Vec<&str> = sections[2].groups.iter().map(|group| group.name).collect();
        assert_eq!(special, vec!["3x3x3 subsets", "Bandaged Cube", "Relays"]);
        assert_eq!(sections[3].groups[0].name, "1x1x1");
    }

    #[test]
    fn keeps_names_unique_inside_their_group() {
        for group in scramble_groups() {
            let labels: std::collections::HashSet<&str> =
                group.choices.iter().map(|choice| choice.label).collect();
            assert_eq!(
                labels.len(),
                group.choices.len(),
                "duplicates in {}",
                group.name
            );
            for choice in &group.choices {
                assert!(!choice.label.trim().is_empty(), "{} label", choice.id);
                assert_eq!(choice.default_length, scramble_length(choice.id));
            }
        }

        let pll = scramble_groups()
            .into_iter()
            .find(|group| group.name == "3x3x3 CFOP")
            .and_then(|group| group.choices.into_iter().find(|choice| choice.id == "pll"));
        assert_eq!(pll.map(|choice| choice.label), Some("PLL"));
        assert_eq!(group_of_scramble_type("pll"), Some("3x3x3 CFOP"));
        assert_eq!(group_of_scramble_type("sq1pll"), Some("Square-1"));
        assert_eq!(group_of_scramble_type("333"), Some("WCA"));
        assert_eq!(group_of_scramble_type("no-such-type"), None);
    }

    #[test]
    fn labels_prefix_the_group() {
        assert_eq!(scramble_type_label("333"), "WCA - 3x3x3");
        assert_eq!(scramble_type_label("pll"), "3x3x3 CFOP - PLL");
        assert_eq!(scramble_type_label("sq1pll"), "Square-1 - PLL");
        for entry in SCRAMBLE_TYPES {
            assert_eq!(
                scramble_type_label(entry.id),
                format!("{} - {}", entry.group, entry.name)
            );
        }
        assert_eq!(scramble_type_label("no-such-type"), "no-such-type");
    }

    #[test]
    fn titles_split_the_label_in_two() {
        assert_eq!(scramble_type_title("333"), ("WCA".into(), "3x3x3".into()));
        assert_eq!(
            scramble_type_title("pll"),
            ("3x3x3 CFOP".into(), "PLL".into())
        );
        for entry in SCRAMBLE_TYPES {
            let (category, name) = scramble_type_title(entry.id);
            let reassembled = if name.is_empty() {
                category
            } else {
                format!("{category} - {name}")
            };
            assert_eq!(reassembled, scramble_type_label(entry.id));
        }
        assert_eq!(
            scramble_type_title("no-such-type"),
            ("no-such-type".into(), String::new())
        );
    }
}
