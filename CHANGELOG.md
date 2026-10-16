# Changelog

Notable changes to this project, most recent first.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`0.0.x` marks **internal stages**, cut when called rather than on a
schedule. `v0.0.1` … `v0.0.7` are the milestone landings M0–M6; `v0.0.8` is
the work that followed. `0.1.0` will be the first public source release.
Versions are a monotonic counter, never derived from a milestone number —
the plan has been renumbered twice, so they cannot be.

## [Unreleased]

## [0.0.8] — 2026-10-16

### Added

- The solve list shows **ao5 and ao12 beside each solve's own result**, so a
  column reads as the history of a run rather than today's number repeated.
- The scramble text is **display-only**; copying moved to a button beside
  refresh and to `Ctrl+C`.
- The **type chooser** is rebuilt on stock widgets: the current type appears
  as the header's title and subtitle, the control is an icon button, the
  dialog's sidebar uses `Adw.Sidebar` with sections taken from csTimer's
  higher classes, and it collapses to two columns below 540 px.
- The header's **image toggle** sits on the right of whichever bar the layout
  is using, and all four scramble controls move together below 540.
- One app menu in the sidebar; `Ctrl+?` opens the keyboard reference.
- The edit dialog is reworked: `Adw.Dialog` header, ordered rows, and an
  expander for long scrambles.
- Scramble diagrams render with **`Gtk.Svg`** instead of `Rsvg`.
- `tools/icon/` generates the app icon from a computed PLL Ga cube state.

### Changed

- **The timer no longer steps aside for the diagram** — it stays centred at
  every size. The offset machinery (timerMargins, NUDGE_SLACK, phoneFormFor)
  and its 19 tests are gone.
- **The type picker is much faster**: opening dropped from ~125–141 ms to
  ~14–25 ms and a category click from ~158 ms to 1.7 ms. `Gtk.ListBox.
  setFilterFunc` re-evaluated all 206 rows on every change (≈79 ms); the list
  now holds only the browsed category's ~19 rows.
- The window floor moves **360×360 → 360×294**, the GNOME HIG phone size, and
  the selector row takes over below 540 instead of 600 — a phone in landscape
  gets the two-column picker.
- The sidebar is capped at 320 at every width.
- Layout reads the CSD shadow from `Gtk.Native` and takes its ground truth
  from `window.content`, so tiers follow the Adaptive Preview instead of a
  feature test.
- Adwaita's built-in styling is preferred over hand-rolled CSS.
- Documentation is split by audience: a user-facing README plus `BUILD.md`,
  `CONTRIBUTING.md` and `DESIGN.md`.

### Fixed

- The type picker no longer grabs focus, so there is no focus ring without
  intent.
- The Statistics table adapts to a narrow window by breakpoint.
- `tools/xtest.py` matches `WM_NAME` as latin-1 as well as UTF-8.

### Project

- Research into embedding `cstimer_module` in a Rust build — six JS engines
  reproduce Node's 206 scrambles byte for byte, so the module can be embedded
  rather than ported. Recorded in `RUST-PORT.md`; not scheduled.

## [0.0.7] — 2026-10-02

**M6 — adaptive layout.**

- The solve list becomes a **drawer** below 800 px, and the header adapts
  instead of truncating.
- Every layout threshold lives in `src/core/layout.ts` as pure functions;
  `main.ts` only measures and applies.
- **Phone form factor**: below 600 px the timer stays centred and lifts by
  half a diagram.
- The window floor drops to 360×360, the GNOME HIG minimum for a phone form
  factor.

## [0.0.6] — 2026-10-02

**M5 — preferences, theming and the scramble diagram.**

- A **Preferences** dialog over a field-validated `prefs.json` in the XDG
  data dir: hold time, WCA inspection, sound cues, scramble image, theme.
- **Dark mode** — system, light or dark, applied before the first paint.
- The **scramble diagram** as an SVG, bottom-right, transparent.
- A **keyboard reference** listing every binding.

## [0.0.5] — 2026-10-02

**M4 — statistics, penalties and WCA inspection.**

- **ao5, ao12 and mo3** with csTimer's rules: best and worst trimmed, DNF as
  infinity so it poisons an average only when it survives trimming, session
  mean over non-DNF solves.
- **+2 and DNF penalties and comments**, applied to the whole selection
  through one edit dialog.
- **WCA inspection**: a 15 s countdown with 8 s and 12 s cues, `+2` at 15 s,
  `DNF` at 17 s, `Escape` to cancel.
- Each session remembers its **scramble type**; switching restores it.

## [0.0.4] — 2026-10-01

**M3 — sessions.**

- **Create, rename, switch and delete** sessions; the library is never empty.
- Each session owns its solve list, its statistics and its scramble type.
- Keyboard session UI: `Ctrl+S` for the menu, `Ctrl+N` new, `F2` rename,
  `Ctrl+Delete` delete.

## [0.0.3] — 2026-10-01

**M2 — solve recording and the list.**

- The solve list is a **`Gtk.ColumnView`**, virtualised so thousands of rows
  stay cheap.
- **Atomic JSON persistence** under the XDG data dir, debounced per session
  and flushed on exit.
- **Delete with an undo toast** — removal is two-step, so a solve goes back
  exactly where it was.

## [0.0.2] — 2026-10-01

**M1 — scrambles.**

- Scramble generation runs in a **`worker_threads` worker**: a 4x4 WCA
  scramble measures ~1.2 s and must never block the UI.
- The **next scramble is always prefetched**, so it is on screen the instant
  a solve finishes.
- A two-level selector over **206 puzzle types**, from csTimer's catalogue.

## [0.0.1] — 2026-09-30

**M0 — scaffold and a hold-space timer.**

- GTK 4 + libadwaita through node-gtk, TypeScript run directly by `tsx`.
- **Hold Space to arm, release to start, press to stop**, timed with
  microsecond precision captured in the key handler rather than a paint
  callback.
- The timer state machine lives in pure TypeScript, key-repeat dedup
  included, so it is unit-testable without a display server.

[Unreleased]: https://github.com/xlucn/puzzle-timer/compare/v0.0.8...HEAD
[0.0.8]: https://github.com/xlucn/puzzle-timer/tree/v0.0.8
[0.0.7]: https://github.com/xlucn/puzzle-timer/tree/v0.0.7
[0.0.6]: https://github.com/xlucn/puzzle-timer/tree/v0.0.6
[0.0.5]: https://github.com/xlucn/puzzle-timer/tree/v0.0.5
[0.0.4]: https://github.com/xlucn/puzzle-timer/tree/v0.0.4
[0.0.3]: https://github.com/xlucn/puzzle-timer/tree/v0.0.3
[0.0.2]: https://github.com/xlucn/puzzle-timer/tree/v0.0.2
[0.0.1]: https://github.com/xlucn/puzzle-timer/tree/v0.0.1
