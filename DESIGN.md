# Design

The current-state architecture of Puzzle Timer and the decisions behind it —
distilled from [PLAN.md](./PLAN.md), which remains the historical record
(every milestone, measurement, and superseded idea lives there).

## The stack

| Choice | Why |
|---|---|
| `gtk4-rs` + `libadwaita` | Native Adwaita UI in Rust; no web stack and no runtime script host |
| `cstimer_module`, vendored and embedded | Official csTimer bundle: 206 WCA-legal scramble types + SVG images, pure JS, GPL-3.0 |
| JavaScriptCore 6 | Runs the bundle from the system library, so the executable stays small; V8 is the documented alternative |
| One scramble thread | One 4×4 WCA scramble takes about a second — it must never run on the UI thread |
| `cargo test` over pure core modules | The timer state machine and the statistics math are testable without a display server |

## The boundary that shapes everything

```
src/
├── main.rs          bootstrap: Adw.Application, stylesheet, window
├── core/            ★ pure Rust — NO gtk4, NO libadwaita, NO JSC, NO IO
│   ├── timer.rs         state machine: idle → holding → ready → running → stopped
│   │                    (+ inspection-ready → inspecting: 15 s → +2, 17 s → DNF)
│   ├── time.rs          formatting, penalty math, DNF-as-∞, inspection clock
│   ├── stats.rs         single/window averages, trimming, spread, PB target
│   ├── charts.rs        histogram bins and trend series for the charts
│   ├── records.rs       PB history per kind (strict improvements only)
│   ├── activity.rs      local-day buckets, streaks, rolling counts
│   ├── calendar.rs      local calendar days through libc's localtime_r/mktime
│   ├── session.rs       Solve & Session models, CRUD, undo, penalties, comments
│   ├── session_library.rs  session index rules: names, ids, order, active, scramble type
│   ├── cs_timer_format.rs  csTimer data-file codec (parse + format, round-trip tested)
│   ├── session_import.rs   parsed file sessions → library entries and seeded Session objects
│   ├── scramble_types.rs   206-type catalogue + group/section structure (data-driven)
│   ├── scramble_feed.rs    prefetch state machine: type switch / advance / ready
│   ├── layout.rs        every size threshold and the adaptive-layout rules
│   ├── i18n.rs          catalog lookup, plural selection, locale resolution
│   ├── preferences.rs   Preferences shape, defaults, per-field validation
│   └── json_number.rs   numbers written the way v0.3.0 wrote them
├── scramble/
│   ├── mod.rs           ScrambleEngine trait and the engine this build uses
│   ├── jsc.rs           the JavaScriptCore C API host and the bundle's shim
│   └── worker.rs        the thread that owns the context, jobs in and results out
├── platform/            OS and IO only
│   ├── store.rs         atomic JSON persistence in the XDG data dir
│   ├── random.rs        CSPRNG seeding
│   ├── audio.rs         inspection beeps — pre-rendered pulses, fire-and-forget
│   ├── transfer.rs      read/write of the file picked in a Gtk.FileDialog
│   ├── date.rs          locale-aware dates through GLib
│   └── meta.rs          version/license/URLs from Cargo.toml, changelog embedded
├── locales/
│   ├── en.rs            source-of-truth catalog and the scramble group/section names
│   └── zh_cn.rs         complete Chinese catalog, typed against en.rs
└── ui/                  GTK widgets — the only place that imports gtk4/libadwaita
```

`style.css` sits at the repository root and is compiled in. `vendor/` holds the
scramble bundle. `data/` holds the hicolor icon tree (full-colour and symbolic)
and `puzzle-timer.desktop`. `docs/` holds the README's screenshot:
documentation, not something an install ships.

Three rules fall out of this split, and they are the ones most worth not
breaking:

1. **`core/` imports neither GTK nor the filesystem.** This keeps the
   timer/stats/session logic unit-testable without a display server, and it is
   the insurance policy: the engine can change, the UI can be rebuilt, and the
   maths and its tests stay put.
2. **OS-specific code lives in `src/platform/`, and the JS engine in
   `src/scramble/`.** Persistence, randomness, audio, file transfer, dates and
   the JavaScriptCore host are all quarantined there.
3. **Only `src/ui/` touches `gtk4` or `libadwaita`.** Widgets talk to `core`
   through plain data and callbacks.

## The key decisions

- **Timing precision.** Start and stop are captured with
  `glib::monotonic_time()` (µs) inside the handler, never in a paint callback.
  Display is formatting an interval, refreshed on a 16 ms tick while running,
  and the tick only exists while there is something to animate. Hold-Space
  logic tracks held keys locally because GTK4 exposes no auto-repeat.
- **Scramble prefetch, one thread.** A dedicated thread creates the
  JavaScriptCore context and owns it for the life of the process; JSC contexts
  are neither `Send` nor `Sync`. The UI hands it plain requests over a channel
  and drains results with `glib::spawn_future_local`, so a slow scramble never
  blocks the window and no JS is evaluated from the main thread. The *next*
  scramble is generated while the user solves, so it is ready the instant they
  finish; the feed is a pure state machine (`core/scramble_feed.rs`).
- **The engine is replaceable.** `ScrambleEngine` in `src/scramble/mod.rs`
  names the two operations the app needs (seed, generate); the default
  implementation is the JavaScriptCore host. A V8 build would alias its own
  type there and change nothing in `core/` or `ui/`. JSC is the default because
  it links the system library and keeps the binary small; V8 is the choice
  when a self-contained engine is worth the heavier dependency.
- **The vendored bundle is evaluated, never ported.** The host shim provides
  the Node-ish globals the bundle expects, plus csTimer's
  `SCRAMBLE_NOOBST`/`SCRAMBLE_NOOBSS` tables. A scramble and its diagram are
  one round trip, and `getImage` answering `false` for a type with no drawing
  rule is a normal result, not an error.
- **Native adaptive layout — not a copy of the csTimer webpage.** The window
  uses `Adw.OverlaySplitView` (solve list as a sidebar that becomes a drawer
  on narrow windows), `Adw.Dialog`/`Adw.PreferencesDialog` for secondary UI,
  `Adw.ToastOverlay` for undo, and `Adw.StatusPage` for empty states.
  Every size rule lives in `core/layout.rs` as pure functions; `src/ui/` only
  measures and applies. The readout, the scramble text, the scramble slot and
  the diagram box are continuous functions of the window — no size tiers — and
  only the two structural decisions stay discrete: the selectors' own row at
  ≤540 and the sidebar's drawer at ≤800. The picture's box follows the
  window's area (√(width × height)) rather than one side, so a portrait and a
  landscape window of the same size show it at the same size. Size
  preferences *scale* those numbers, they never replace them. Resizes come
  from `Gdk.Surface::layout` and the after-paint pass (a breakpoint only fires
  on a boundary crossing), and the sizes read the window, so docking the
  sidebar never changes the font. The diagram sits beside the timer when the
  content width clears a sidebar-aware threshold: 1.4× its height with the
  sidebar hidden, or 0.7× its height with it docked, because the docked
  sidebar offsets the diagram and keeps the timer near the window centre. A
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
  overwritten. Files keep the exact v0.3.0 shape, down to key order and
  numbers without a fractional part, so an existing data directory is read as
  it was written.
- **Deletions are always undoable.** Removal is two-phase (`remove()` records
  the index, `restore()` puts it back), surfaced as one undo toast per batch.
  There is deliberately no `Ctrl+Z` — a shortcut that deletes a record is not
  intuitive; the toast is the undo.
- **WCA inspection is a timer state, not a side feature.** The first press
  turns the readout green (`inspection-ready`) without a hold; its release
  starts the 15 s countdown (graded `+2` at 15 s, `DNF` at 17 s), and the
  second press-hold-release starts the solve. Cues at 8 s and 12 s fire
  exactly once each per inspection. Esc cancels.
- **Touch mirrors the keyboard where it can.** The main content view's
  `Gtk.GestureClick` emits the same `keyDown`/`keyUp` calls Space does — the
  whole area under the bars, not just the digits, is the start key — and the
  countdown's Cancel button in the header takes Escape's path — so there is
  exactly one state machine, one deletion path, and one undo, whatever the
  input device. Touch is always accepted; mouse control is opt-in, so a stray
  click cannot arm a solve by default. From the first press until the timer
  stops, the scramble, hints, averages, bottom bar and solve list hide; the
  list's header toggle and the diagram toggle grey out, while the header
  itself stays. The list's previous open/closed state returns when the timer
  is idle or stopped. Ctrl+B and Ctrl+S are inert while the timer owns the
  view. The solve list keeps GTK's own Ctrl/Shift-click multi-select; touch has
  no modifier, so the list carries no touch gesture of its own. Deletion has no
  gesture either: a swipe gives no visible hint that it exists, so it stays on
  the footer's Delete button.
- **One version, one place.** The app version comes from `Cargo.toml` via
  `env!("CARGO_PKG_VERSION")`, never a literal. The About dialog parses its
  release notes from the embedded `CHANGELOG.md`.
- **i18n is typed catalogs, not gettext.** `src/core/i18n.rs` holds a
  module-level locale and `t()`; `src/locales/en.rs` is the source of truth
  and `zh_cn.rs` is an exhaustive map, so a missing translation is a compile
  error. The `language` preference is resolved once, before any widget is
  built, because catalogs are read while widgets are constructed; changing it
  needs a restart.

## csTimer compatibility

The format is a pure codec (`src/core/cs_timer_format.rs`, round-trip tested);
`src/core/session_import.rs` turns parsed sessions into library entries and
seeds their `Session` objects before the library announces them. Only the
file dialogs and the toasts are UI. Two findings from csTimer's own source
shape the export: a file carrying `properties` makes csTimer clear its
`localStorage`, and importing into csTimer **overwrites** sessions rather than
merging — so an export must carry `properties = { sessionN, sessionData }`,
and importing into csTimer is a *restore*, not an append. Importing *from*
csTimer is the safe direction.

## Licensing

GPL-3.0-or-later, required by `cstimer_module` and by the rule for porting
csTimer's GPL source: **the math, not the DOM** (statistics rules, the
data-file format, chart math). It is compatible with GTK/libadwaita (LGPL),
the gtk-rs bindings (MIT) and JavaScriptCore (LGPL-2.1). csTimer and
`cstimer_module` are credited in the About dialog.
