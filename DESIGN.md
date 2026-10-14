# Design

The current-state architecture of cstimer-gtk and the decisions behind it —
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
│   │                    (+ WCA inspection: 15 s → +2, 17 s → DNF)
│   ├── time.ts          formatting, penalty math, DNF-as-∞, inspection clock
│   ├── stats.ts         ao5/ao12/mo3 trimming, best single/avg, PB target
│   ├── session.ts       Solve & Session models, CRUD, undo, penalties, comments
│   ├── sessionLibrary.ts  session index rules: names, ids, active, scramble type
│   ├── scrambleTypes.ts   206-type catalogue + group/section structure (data-driven)
│   ├── scrambleFeed.ts    prefetch state machine: type switch / advance / ready
│   ├── layout.ts        every size threshold and the adaptive-layout rules
│   └── preferences.ts   Preferences shape, defaults, per-field validation
├── scramble/
│   ├── worker.ts        worker_threads host for cstimer_module
│   ├── protocol.ts      typed request/response messages worker ↔ main
│   ├── cstimerLang.ts   type-id → cstimer_module language-table mapping
│   └── service.ts       prefetch queue — the next scramble is always warm
├── platform/
│   ├── store.ts         atomic JSON persistence in the XDG data dir
│   ├── random.ts        CSPRNG seeding
│   ├── audio.ts         inspection beeps — pre-rendered pulses, fire-and-forget
│   └── meta.ts          version/license/URLs, read from package.json
└── ui/                 GTK widgets — the only place that imports gi:*
```

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
  Every size threshold lives in `core/layout.ts` as pure functions;
  `main.ts` only measures and applies. Size preferences *scale* the tiers,
  they never replace them.
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
- **WCA inspection is a timer state, not a side feature.** The first
  ready→release starts the 15 s countdown (graded `+2` at 15 s, `DNF` at
  17 s); the second starts the solve. Cues at 8 s and 12 s fire exactly once
  each per inspection. Esc cancels.
- **Touch mirrors the keyboard.** A gesture emits the same `keyDown`/
  `keyUp` calls Space does, and list gestures end in the same `remove()` →
  undo-toast path — so there is exactly one state machine, one deletion
  path, and one undo, whatever the input device.
- **One version, one place.** The app version comes from `package.json` via
  `src/platform/meta.ts`, never a literal.

(Not yet built, but decided: i18n through typed TypeScript catalogs — see
PLAN.md decision 11.)

## csTimer compatibility

csTimer's data-file format is implemented as a pure codec
(`src/core/csTimerFormat.ts`, round-trip tested); only the file chooser and
the toast are UI. Two findings from csTimer's own source shape the export: a
file carrying `properties` makes csTimer clear its `localStorage`, and
importing into csTimer **overwrites** sessions rather than merging — so an
export must carry `properties = { sessionN, sessionData }`, and importing
into csTimer is a *restore*, not an append. Importing *from* csTimer is the
safe direction.

## Licensing

GPL-3.0-or-later, required by `cstimer_module` and by the rule for porting
csTimer's GPL source: **the math, not the DOM** (statistics rules, the
data-file format, chart math). Compatible with GTK/libadwaita (LGPL) and
node-gtk (MIT). csTimer and `cstimer_module` are credited in the About
dialog.
