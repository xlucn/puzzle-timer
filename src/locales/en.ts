/*
 * en.ts — the English catalog: the source of truth for every user-visible
 * string, and the key set each other locale must cover.
 *
 * Keys are dotted by area (`menu.*`, `prefs.*`, `stats.*`). A value is either
 * a string or a plural object: `{ one, other }` resolved by
 * `Intl.PluralRules` from the caller's `count` param (src/core/i18n.ts).
 * Placeholders are `{name}` and are filled by `t(key, params)`.
 *
 * Everything here is written for the user; timestamps stay numeric and are
 * built in src/core/time.ts, not translated.
 */
export const en = {
  // ---- app ---------------------------------------------------------------
  'app.name': 'Puzzle Timer',
  'app.about.comments':
    'A native GTK4 speedcubing timer, inspired by csTimer by Shuang Chen.\n' +
    'Scrambles are provided by the cstimer_module package, part of the csTimer project (GPL-3.0).\n' +
    'Written with the assistance of AI/LLM tools.',
  'app.about.builtWith': 'Built with',

  // ---- common ------------------------------------------------------------
  'common.cancel': 'Cancel',
  'common.create': 'Create',
  'common.delete': 'Delete',
  'common.rename': 'Rename',
  'common.save': 'Save',
  'common.undo': 'Undo',

  // ---- app menu ----------------------------------------------------------
  'menu.main': 'Main menu',
  'menu.statistics': 'Statistics',
  'menu.fullscreen': 'Fullscreen',
  'menu.exitFullscreen': 'Exit Fullscreen',
  'menu.preferences': 'Preferences',
  'menu.shortcuts': 'Keyboard Shortcuts',
  'menu.quit': 'Quit',
  'menu.cancelInspection': 'Cancel the inspection (Esc)',
  'menu.showList': 'Show solve list',
  'menu.about': 'About {name}',
  'menu.importData': 'Import from csTimer…',
  'menu.exportData': 'Export to csTimer…',

  // ---- timer -------------------------------------------------------------
  'timer.hint.idle': 'Hold Space or touch to start',
  'timer.hint.holding': 'Keep holding…',
  'timer.hint.ready': 'Release to start',
  'timer.hint.inspectionReady': 'Release to inspect',
  'timer.hint.inspecting': 'Inspection — Space starts, Esc cancels',
  'timer.hint.running': 'Press any key or tap to stop',

  // ---- scramble ----------------------------------------------------------
  'scramble.generating': 'Generating scramble…',
  'scramble.diagram': 'Scramble diagram',
  'scramble.new': 'New scramble',
  'scramble.copy': 'Copy the scramble (Ctrl+C)',
  'scramble.copied': 'Scramble copied',
  'scramble.image': 'Show the scramble image',
  'scramble.type': 'Scramble type',
  'scramble.chooseType': 'Choose the scramble type',
  'scramble.options': 'Scramble options',
  'scramble.category': 'Category',
  'scramble.fast': 'Fast scramble',
  'scramble.moves': 'Moves',
  'scramble.scrambles': 'Number of scrambles',
  'scramble.cubes': 'Number of cubes',
  'scramble.failed': 'Scramble failed: {reason}',

  // ---- csTimer transfer --------------------------------------------------
  'transfer.import.title': 'Import from csTimer',
  'transfer.import.accept': 'Import',
  'transfer.export.title': 'Export to csTimer',
  'transfer.filter': 'csTimer data',
  'transfer.export.accept': 'Export',
  'transfer.import.sessions': { one: '{count} session', other: '{count} sessions' },
  'transfer.import.solves': { one: '{count} solve', other: '{count} solves' },
  'transfer.import.done': 'Imported {sessions}, {solves}.',
  'transfer.import.warnings': {
    one: '{count} warning — see the log',
    other: '{count} warnings — see the log',
  },
  'transfer.import.failed': 'Import failed',
  'transfer.export.done': 'Exported to {name}',
  'transfer.export.failed': 'Export failed',

  // ---- preferences -------------------------------------------------------
  'prefs.title': 'Preferences',
  'prefs.timer.title': 'Timer',
  'prefs.timer.group': 'Starting a solve',
  'prefs.inspection': 'WCA inspection',
  'prefs.inspection.subtitle': 'Show a 15-second count down before the solve starts',
  'prefs.cues': 'Inspection sound cues',
  'prefs.cues.subtitle': 'If enabled, first beep at 8 s, second at 12 s',
  'prefs.hold': 'Hold time',
  'prefs.hold.subtitle': 'How long Space must be held to start the timer',
  'prefs.mouse': 'Mouse control',
  'prefs.mouse.subtitle': 'Control the timer with the mouse',
  'prefs.appearance.title': 'Appearance',
  'prefs.scheme.group': 'Colour scheme',
  'prefs.theme': 'Theme',
  'prefs.theme.system': 'Follow system',
  'prefs.theme.light': 'Light',
  'prefs.theme.dark': 'Dark',
  'prefs.sizes.group': 'Sizes',
  'prefs.sizes.description': 'Scale the timer, the scramble text and the image.',
  'prefs.size.timer': 'Timer',
  'prefs.size.timer.subtitle': 'Size of the timer digits',
  'prefs.size.scramble': 'Scramble text',
  'prefs.size.scramble.subtitle': 'Size of the scramble above the timer',
  'prefs.size.diagram': 'Scramble image',
  'prefs.size.diagram.subtitle': 'Size of the scramble picture',
  'prefs.page.scramble': 'Scramble',
  'prefs.preScramble.group': 'Pre-scramble',
  'prefs.preScramble.description': 'Moves applied to the scramble diagram, e.g. y or z2.',
  'prefs.preScramble.row': 'Moves',
  'prefs.image.group': 'Image',
  'prefs.image.description': 'Show the picture of the scramble.',
  'prefs.image.row': 'Show the scramble image',
  'prefs.language.group': 'Language',
  'prefs.language.row': 'Language',
  'prefs.language.system': 'Follow system',
  'prefs.language.english': 'English',
  'prefs.language.chinese': '中文',
  'prefs.language.restart': 'Restart to apply the language',

  // ---- sessions ----------------------------------------------------------
  'session.tooltip': 'Session',
  'session.new.tooltip': 'New session (Ctrl+N)',
  'session.new': 'New session',
  'session.new.description': 'Each session keeps its own list of solves.',
  'session.name': 'Session name',
  'session.rename': 'Rename session',
  'session.delete.title': 'Delete “{name}”?',
  'session.delete.empty': 'This cannot be undone.',
  'session.delete.body': {
    one: '{count} solve will be removed. This cannot be undone.',
    other: '{count} solves will be removed. This cannot be undone.',
  },
  'session.rename.menu': 'Rename…',
  'session.delete.menu': 'Delete…',
  'session.error.name': 'A session needs a name.',
  'session.error.long': 'Names are up to {count} characters.',
  'session.error.taken': 'A session with that name already exists.',

  // ---- solve list --------------------------------------------------------
  'list.time': 'Time',
  'list.scramble': 'Scramble',
  'list.date': 'Date',
  'list.empty.title': 'No solves yet',
  'list.empty.body': 'Finish a solve and it will appear here.',
  'list.edit.tooltip': 'Edit the selected solve — penalty and comment (Ctrl+E)',
  'list.edit': 'Edit',
  'list.delete.tooltip': 'Delete the selected solve(s) (Delete)',
  'list.copy.scramble': 'Copy the scramble',
  'list.copy.date': 'Copy the date',
  'list.penalty': 'Penalty',
  'list.penalty.ok': '_OK',
  'list.penalty.plus2': '+_2',
  'list.penalty.dnf': '_DNF',
  'list.comment': 'Comment',
  'list.edit.title': 'Edit solve #{number}',
  'list.selected': { one: '{count} selected', other: '{count} selected' },

  // ---- statistics --------------------------------------------------------
  'stats.title': 'Statistics',
  'stats.single': 'Single',
  'stats.mo3': 'mo3',
  'stats.ao5': 'ao5',
  'stats.ao12': 'ao12',
  'stats.any': 'Any',
  'stats.current': 'Current',
  'stats.best': 'Best',
  'stats.target': 'Target',
  'stats.empty': 'No solves yet',
  'stats.mean': 'Session mean',
  'stats.solves': { one: '{count} solve', other: '{count} solves' },
  'stats.counted': '{count} of {total} counted',
  'stats.dnf': { one: '{count} DNF', other: '{count} DNFs' },
  'stats.ao50': 'ao50',
  'stats.ao100': 'ao100',
  'stats.ao1000': 'ao1000',
  'stats.spread': 'Spread',
  'stats.worst': 'Worst',
  'stats.range': 'Range',
  'stats.sigma': 'σ',
  'stats.totalTime': 'Total time',
  'stats.tab.summary': 'Summary',
  'stats.tab.records': 'Records',
  'stats.tab.activity': 'Activity',
  'stats.records.group': 'Personal bests',
  'stats.records.description':
    'Only improvements count. Each row shows when it was set and how long it stood.',
  'stats.records.none': 'No record yet',
  'stats.records.current': 'still standing',
  'stats.records.setDate': 'Set {date}',
  'stats.records.setSolve': 'Set at #{number}',
  'stats.records.heldDays': { one: 'held {count} day', other: 'held {count} days' },
  'stats.records.heldSameDay': 'broken the same day',
  'stats.records.older': {
    one: '{count} older improvement not shown',
    other: '{count} older improvements not shown',
  },
  'stats.records.heldSolves': { one: 'held {count} solve', other: 'held {count} solves' },
  'stats.activity.totalSolves': 'Solves',
  'stats.activity.today': 'Today',
  'stats.activity.last7': 'Last 7 days',
  'stats.activity.last30': 'Last 30 days',
  'stats.activity.activeCount': {
    one: '{count} active day',
    other: '{count} active days',
  },
  'stats.activity.currentStreak': 'Current streak',
  'stats.activity.longestStreak': 'Longest streak',
  'stats.activity.days': { one: '{count} day', other: '{count} days' },
  'stats.activity.activeDays': 'Active days',
  'stats.activity.perDay': 'Solves per active day',
  'stats.activity.bestDay': 'Best day',
  'stats.activity.undated': 'Solves without a date',
  'stats.activity.recent': 'Recent days',
  'stats.activity.less': 'Less',
  'stats.activity.more': 'More',
  'stats.activity.noSolves': 'No solves',

  // ---- keyboard shortcuts ------------------------------------------------
  'shortcuts.title': 'Keyboard Shortcuts',
  'shortcuts.group.timer': 'Timer',
  'shortcuts.group.scramble': 'Scramble',
  'shortcuts.group.list': 'Solve list',
  'shortcuts.group.sessions': 'Sessions',
  'shortcuts.group.general': 'General',
  'shortcuts.group.data': 'Data',
  'shortcuts.startStop': 'Start and stop the timer',
  'shortcuts.cancelInspection': 'Cancel the inspection countdown',
  'shortcuts.copyScramble': 'Copy the scramble',
  'shortcuts.sidebar': 'Show or hide the sidebar',
  'shortcuts.hideDrawer': 'Hide the drawer',
  'shortcuts.deleteSolves': 'Delete the selected solves',
  'shortcuts.clearPenalty': 'Clear the penalty of the newest solve',
  'shortcuts.plus2': 'Give the newest solve +2',
  'shortcuts.dnf': 'Mark the newest solve DNF',
  'shortcuts.editSolve': 'Edit the selected (or newest) solve',
  'shortcuts.sessionMenu': 'Open the session menu',
  'shortcuts.newSession': 'New session',
  'shortcuts.renameSession': 'Rename the active session',
  'shortcuts.deleteSession': 'Delete the active session',
  'shortcuts.statistics': 'Open the statistics dialog',
  'shortcuts.keyboard': 'Open the keyboard reference',
  'shortcuts.preferences': 'Open preferences',
  'shortcuts.fullscreen': 'Toggle fullscreen',
  'shortcuts.quit': 'Quit',
  'shortcuts.importData': 'Import from csTimer',
  'shortcuts.exportData': 'Export to csTimer',

  // ---- toasts ------------------------------------------------------------
  'toast.solvesDeleted': { one: 'Solve deleted', other: '{count} solves deleted' },
  'toast.sessionFileUnreadable': 'Session file could not be read',
  'toast.sessionListUnreadable': 'Session list could not be read',
  'toast.settingsUnreadable': 'Settings could not be read — defaults are in use',
} as const

/**
 * One catalog value: plain text, or plural forms selected by
 * `Intl.PluralRules`. `other` is the required fallback; English adds `one`,
 * Chinese needs only `other`.
 */
export type Message =
  | string
  | ({ readonly other: string } & Partial<Record<Intl.LDMLPluralRule, string>>)

/** Keys every locale must provide. */
export type MessageKey = keyof typeof en

/**
 * Scramble group names, keyed by the catalogue's own name. The type picker
 * and the header title show these, so they are translated too; the ~200 type
 * names themselves stay English for now. `i18n.test.ts` checks that
 * this list and the catalogue's groups are the same set.
 */
export const enGroupNames = {
  WCA: 'WCA',
  '3x3x3': '3x3x3',
  '3x3x3 CFOP': '3x3x3 CFOP',
  '3x3x3 Roux': '3x3x3 Roux',
  '3x3x3 Mehta': '3x3x3 Mehta',
  '2x2x2': '2x2x2',
  '4x4x4': '4x4x4',
  '4x4x4 Yau/Hoya': '4x4x4 Yau/Hoya',
  '5x5x5': '5x5x5',
  '6x6x6': '6x6x6',
  '7x7x7': '7x7x7',
  Clock: 'Clock',
  Megaminx: 'Megaminx',
  Pyraminx: 'Pyraminx',
  Skewb: 'Skewb',
  'Square-1': 'Square-1',
  'FTO (Face-Turning Octahedron)': 'FTO (Face-Turning Octahedron)',
  '15 puzzle': '15 puzzle',
  '8 puzzle': '8 puzzle',
  LxMxN: 'LxMxN',
  'Gear Cube': 'Gear Cube',
  Kilominx: 'Kilominx',
  Gigaminx: 'Gigaminx',
  'Crazy Puzzle': 'Crazy Puzzle',
  Cmetrick: 'Cmetrick',
  'Helicopter Cube': 'Helicopter Cube',
  'Redi Cube': 'Redi Cube',
  'Dino Cube': 'Dino Cube',
  'Ivy cube': 'Ivy cube',
  'Master Pyraminx': 'Master Pyraminx',
  'Pyraminx Crystal': 'Pyraminx Crystal',
  'Siamese Cube': 'Siamese Cube',
  Square: 'Square',
  'Super Floppy': 'Super Floppy',
  UFO: 'UFO',
  Icosahedron: 'Icosahedron',
  '3x3x3 subsets': '3x3x3 subsets',
  'Bandaged Cube': 'Bandaged Cube',
  Relays: 'Relays',
  '1x1x1': '1x1x1',
  '-1x-1x-1': '-1x-1x-1',
  '1x1x2': '1x1x2',
  LOL: 'LOL',
  'Derrick Eide': 'Derrick Eide',
} as const

/** The four higher classes the picker's sidebar groups categories under. */
export const enSectionNames = {
  WCA: 'WCA',
  Other: 'Other',
  Special: 'Special',
  Jokes: 'Jokes',
} as const

/** Category keys every locale must cover. */
export type GroupNameKey = keyof typeof enGroupNames

/** Section keys every locale must cover. */
export type SectionNameKey = keyof typeof enSectionNames
