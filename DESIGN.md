# Design

The current-state architecture of Puzzle Timer and the decisions behind it —
distilled from [PLAN.md](./PLAN.md), which remains the historical record
(every milestone, measurement, and superseded idea lives there).

## The stack

| Choice | Why |
|---|---|
| `node-gtk` + GTK 4 + libadwaita | Native Adwaita UI with TypeScript and a CSS hot-reload loop; no web stack |
| `cstimer_module` (npm) | Official csTimer package: 206 WCA-legal scramble types + SVG images, pure JS, GPL-3.0 |
| `worker_threads` | One 4×4 WCA scramble takes ~1.2 s — it must never run on the UI thread |
| Vitest over pure core modules | The timer state machine and the statistics math are testable without a display server |

## The boundary that shapes everything

```
src/
├── main.ts          bootstrap: application, window, header, actions, layout wiring
├── core/            ★ pure TypeScript — NO `gi:`, NO Node APIs
│   ├── timer.ts         state machine: idle → holding → ready → running → stopped
│   │                    (+ inspection-ready → inspecting: 15 s → +2, 17 s → DNF)
│   ├── time.ts          formatting, penalty math, DNF-as-∞, inspection clock
│   ├── stats.ts         ao5/ao12/mo3 trimming, best single/avg, PB target
│   ├── session.ts       Solve & Session models, CRUD, undo, penalties, comments
│   ├── sessionLibrary.ts  session index rules: names, ids, active, scramble type
│   ├── csTimerFormat.ts   csTimer data-file codec (parse + format, round-trip tested)
│   ├── sessionImport.ts   parsed file sessions → library entries and seeded Session objects
│   ├── scrambleTypes.ts   206-type catalogue + group/section structure (data-driven)
│   ├── scrambleFeed.ts    prefetch state machine: type switch / advance / ready
│   ├── layout.ts        every size threshold and the adaptive-layout rules
│   ├── i18n.ts          t(), plural selection, locale + system-language resolution
│   └── preferences.ts   Preferences shape, defaults, per-field validation
├── scramble/
│   ├── worker.ts        worker_threads host for cstimer_module
│   ├── protocol.ts      typed request/response messages worker ↔ main
│   ├── cstimerLang.ts   type-id → cstimer_module language-table mapping
│   └── service.ts       prefetch queue — the next scramble is always warm
├── locales/
│   ├── en.ts            source-of-truth catalog and the scramble group/section names
│   └── zh-CN.ts         complete Chinese catalog, typed against en.ts
├── platform/
│   ├── store.ts         atomic JSON persistence in the XDG data dir
│   ├── random.ts        CSPRNG seeding
│   ├── audio.ts         inspection beeps — pre-rendered pulses, fire-and-forget
│   ├── files.ts         async read/write of the file picked in a Gtk.FileDialog
│   └── meta.ts          version/license/URLs, read from package.json
└── ui/                 GTK widgets — the only place that imports gi:*
```

`data/` sits beside `src/` — the hicolor icon tree (full-colour and
symbolic) plus `puzzle-timer.desktop`. `docs/` holds the README's screenshot:
documentation, not something an install ships.

Three rules fall out of this split, and they are the ones most worth not
breaking:

1. **`core/` imports neither `gi:*` nor Node-only APIs.** This keeps the
   timer/stats/session logic unit-testable without a display server, and it
   is the insurance policy: if node-gtk ever becomes unmaintainable, a
   runtime swap (e.g. to GJS) would touch only `ui/`, `platform/`, and
   `scramble/`, carrying `core/` and its tests untouched.
2. **Node-specific code lives in `src/platform/` and `src/scramble/`.**
   Persistence, randomness, audio, and the worker host are all Node-shaped,
   and they are quarantined there.
3. **Only `src/ui/` touches `gi:*`.** Widgets talk to `core` through plain
   callbacks and plain data.

## The key decisions

- **Timing precision.** Start/stop are captured with
  `GLib.get_monotonic_time()` (µs) inside the key handler, never in a paint
  callback. Display is formatting an interval, refreshed on a 16 ms tick
  while running. Hold-Space logic tracks held keys locally because GTK4
  exposes no auto-repeat.
- **Scramble prefetch.** A worker thread plus a queue: the *next* scramble is
  generated while the user solves, so it is ready the instant they finish.
  The feed is a pure state machine (`core/scrambleFeed.ts`), the worker host
  is replaceable, and nothing blocks the UI.
- **Native adaptive layout — not a copy of the csTimer webpage.** The window
  uses `Adw.OverlaySplitView` (solve list as a sidebar that becomes a drawer
  on narrow windows), `Adw.Dialog`/`Adw.PreferencesDialog` for secondary UI,
  `Adw.ToastOverlay` for undo, and `Adw.StatusPage` for empty states.
  Every size rule lives in `core/layout.ts` as pure functions;
  `main.ts` only measures and applies. The readout, the scramble text, the
  scramble slot and the diagram box are continuous functions of the window —
  no size tiers — and only the two structural decisions stay discrete: the
  selectors' own row at ≤540 and the sidebar's drawer at ≤800. The picture's
  box follows the window's area (√(width × height)) rather than one side, so
  a portrait and a landscape window of the same size show it at the same
  size. Size preferences *scale* those numbers, they never replace them.
  Resizes come from `Gdk.Surface::layout` and the after-paint pass (a
  breakpoint only fires on a boundary crossing), and the sizes read the
  window, so docking the sidebar never changes the font. The diagram sits
  beside the timer when the content width clears a sidebar-aware threshold:
  1.4× its height with the sidebar hidden, or 0.7× its height with it docked,
  because the docked sidebar offsets the diagram and keeps the timer near the
  window centre. A
  narrower or taller content area stacks it below so the timer can centre, and
  a short, narrow window sheds it entirely (a zero cap, not a smaller
  constant) rather than letting it sit on the timer. Its SVG is parsed once
  and drawn into a pinned box, so resizing never re-parses a picture.
- **`Gtk.ColumnView`, not `Gtk.ListBox`.** A session can hold thousands of
  solves; ColumnView is virtualized and only builds the rows on screen. The
  model is a list of solve *ids*, and cells read their text from the session
  in `bind`, so a delete (and its undo) can never point at the wrong row.
- **One JSON file per session, atomic writes.** Sessions live under the XDG
  data dir; each write goes to a temp file and is renamed into place,
  debounced, with `flush()` on quit. Unreadable files are quarantined, never
  overwritten.
- **Deletions are always undoable.** Removal is two-phase (`remove()` records
  the index, `restore()` puts it back), surfaced as one undo toast per
  batch. There is deliberately no `Ctrl+Z` — a shortcut that deletes a
  record is not intuitive; the toast is the undo.
- **WCA inspection is a timer state, not a side feature.** The first press
  turns the readout green (`inspection-ready`) without a hold; its release
  starts the 15 s countdown (graded `+2` at 15 s, `DNF` at 17 s), and the
  second press-hold-release starts the solve. Cues at 8 s and 12 s fire
  exactly once each per inspection. Esc cancels.
- **Touch mirrors the keyboard where it can.** The main content view's
  `Gtk.GestureClick` emits the same `keyDown`/`keyUp` calls Space does — the
  whole area under the bars, not just the digits, is the start key — and
  the countdown's Cancel button in the header takes Escape's path — so there
  is exactly one state machine, one deletion path, and one undo, whatever
  the input device. Touch is always accepted; mouse control is opt-in, so a
  stray click cannot arm a solve by default. From the first press until the
  timer stops, the scramble, hints, averages, bottom bar and solve list hide;
  the list's header toggle and the diagram toggle grey out, while the header
  itself stays. The list's previous open/closed state returns when the timer
  is idle or stopped. Ctrl+B and Ctrl+S are inert while the timer owns the
  view. The solve list keeps GTK's
  own Ctrl/Shift-click multi-select; touch has no modifier, so the list
  carries no touch gesture of its own. Deletion has no gesture either: a swipe
  gives no visible hint that it exists, so it stays on the footer's Delete
  button.
- **One version, one place.** The app version comes from `package.json` via
  `src/platform/meta.ts`, never a literal.
- **i18n is typed catalogs, not gettext.** `src/core/i18n.ts` holds a
  module-level locale and `t()`; `src/locales/en.ts` is the source of truth
  and `zh-CN.ts` is a `Record<MessageKey, Message>`, so a missing translation
  is a compile error. The `language` preference is resolved once, in
  `main.ts` before any widget is built, because catalogs are read while
  widgets are constructed; changing it needs a restart.

## csTimer compatibility

The format is a pure codec (`src/core/csTimerFormat.ts`, round-trip tested);
`src/core/sessionImport.ts` turns parsed sessions into library entries and
seeds their `Session` objects before the library announces them. Only the
file dialogs and the toasts are UI. Two findings from
csTimer's own source shape the export: a file carrying `properties` makes
csTimer clear its `localStorage`, and importing into csTimer **overwrites**
sessions rather than merging — so an export must carry
`properties = { sessionN, sessionData }`, and importing into csTimer is a
*restore*, not an append. Importing *from* csTimer is the safe direction.

## Licensing

GPL-3.0-or-later, required by `cstimer_module` and by the rule for porting
csTimer's GPL source: **the math, not the DOM** (statistics rules, the
data-file format, chart math). Compatible with GTK/libadwaita (LGPL) and
node-gtk (MIT). csTimer and `cstimer_module` are credited in the About
dialog.
