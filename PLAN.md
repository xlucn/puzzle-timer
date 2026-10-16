# cstimer-gtk — implementation plan

A native Linux cube timer that works like <https://cstimer.net/>, built with
GTK4 + libadwaita via node-gtk. This document is the durable plan and the
handoff artifact between sessions: a cold session should read this file and be
able to continue at the current milestone.

---

## 1. Scope

**MVP (M0–M5):** timers, scrambles, sessions, statistics.

**Scheduled (M7–M16, decided 2026-10-05; M16 added 2026-10-06, M8 added
2026-10-10; queue reordered 2026-10-16).** The queue is **M13 → M14 → M15**
first — release readiness, then touch input, then the phone-runtime verdict —
followed by M7–M12 and M16. Numbers are stable identifiers, not queue
positions (§6). Two of the adjacencies are dependencies rather than
preferences: i18n lands ahead of every string-heavy feature, so those are
written translated instead of swept afterwards, and M13 comes before M16
because an AUR package needs a name, an icon and a tag to point at:

- **M13 — release readiness.** Start versioning and prepare a public source
  release: one version source of truth (`package.json`), a CHANGELOG, an
  About dialog that matches reality (it currently shows a *hardcoded*
  `0.1.0`, the wrong licence enum, and a **deprecated** widget), a user-first
  README that states plainly how AI/LLM assistance was used, plus an icon and
  a public name. The last two are gated on open decisions — see §6 M13.
- **M14 — touch input, and the narrow-window leftovers.** Today the app
  cannot start a solve without a Space key: there is **not one gesture or
  touch controller in `src/`**. Touch-hold on the timer mirrors Space exactly
  (decision 15), long press and swipe drive the solve list, and a **re-measure
  of the 360×360 diagram/timer overlap** — the nudge whose clamp caused it was
  dropped on 2026-10-05, so it may already be gone (see §6 M14). Entirely
  desktop-verifiable with the existing harness — see §6.
- **M15 — phone runtime (an evaluation, not a port).** The verdict on
  whether this can run on a real Linux phone at all: arm64 Node ≥ 20.6, a
  node-gtk native binding build, audio without `pw-play`. Its deliverable is
  a written result plus a scoped packaging milestone — or a documented "not
  viable". **M15 decides whether packaging reopens any *further* — M16 has
  already opened the AUR slice.**
- **M7 — size preferences.** Timer readout, scramble text and scramble
  diagram sizes, each a *scale* handed to `layoutFor()` rather than a
  replacement for its tiers (decision 14).
- **M8 — scramble type options.** csTimer's per-type controls: the scramble
  **length / count** (number of scrambles for MBLD, move counts for
  random-move types), **neutral orientation**, **pre-scramble** rotations and
  the `444wca → 444m` fast alias. The **case filter is documented as blocked
  upstream** — `cstimer_module` does not export `getExtra`/`rndState`, so it
  would take an upstream change or a re-implementation of the case-filter
  tables. Independent of every other milestone; evidence and design calls in
  §6.
- **M9 — i18n.** A `t()` over typed catalogs (`src/locales/en.ts` is the
  source of truth, `zh-CN.ts` is `Record<keyof typeof en, …>` so the compiler
  lists every missing translation), a `language` preference
  (`system | en | zh-CN`, restart to apply), and `Intl` for dates and counts.
- **M10 — csTimer-compatible import/export.** One JSON codec, both
  directions (was "dropped as not needed" on 2026-09-30; reinstated by
  decision 2026-10-05). Format evidence in §5, decisions 11–12 in §4.
- **M11 — records and statistics**: PB history (value, date, how long it
  stood), σ / best / worst / range, ao50/ao100/ao1000, per-day activity
  (solves/day, current + longest streak, best day). The Statistics dialog
  grows tabs (`Adw.ViewStack`).
- **M12 — charts** (time trend, distribution), moved out of the long-term
  list below by the same decision: `Gtk.DrawingArea` + Cairo line/path
  drawing; math ported from csTimer's `src/js/stats/trend.js` and
  `src/js/stats/distribution.js` (GPL — port the math, not the DOM). Stats
  already live in `core/`, so charts are rendering-only on top.
- **M16 — AUR package.** A PKGBUILD that precompiles with Arch's own
  `typescript` (in [extra]) and ships only `dist/` plus the two npm runtime
  dependencies: about **13 MiB installed against today's 39 MiB**
  `npm install --omit=dev` tree — because `node-gtk` declares `node-gyp` and
  `@mapbox/node-pre-gyp` as *production* deps and drags 113 lockfile packages
  in behind them. **Blocked on M13** (a package needs a name, an icon, a
  `.desktop` file and a tag for `source=()` to point at); the draft PKGBUILD
  and every measurement are in §6.

**Explicitly out of scope for now:**
- Bluetooth smart cube support (decided: not in v1)
- Virtual cube, solvers, batch generators, cross-session stats
- Packaging/distribution (personal use only for now) — **one exception,
  decided 2026-10-06: an AUR package, scheduled as M16.** A PKGBUILD is just
  a recipe over a source tarball: no infrastructure, no publishing pipeline,
  and it doubles as proof that a stranger can build this from a tag.
  Everything else (Flatpak, deb, AppStream publishing) stays closed until
  **M15** reports yes.

**Long-term goals (added by decision, not scheduled):**
- **Stackmat support** — `serialport` npm package + udev rule; protocol logic
  ported from csTimer's `src/js/hardware/stackmat.js` (GPL). Input source
  feeds `core/timer.ts`, so it is purely additive.

---

## 2. Stack decision (resolved)

| Choice | Verdict |
|---|---|
| `node-gtk` + libadwaita | **Chosen.** Active (last push 2026-07), Adwaita first-class, TypeScript scaffold, CSS hot-reload, prebuilds for Node 22/24/26. |
| `cstimer_module` npm | **Chosen.** Official (author `cs0x7f`), v0.1.5 released 2026-02, pure JS, GPL-3.0, 206 scramble types + SVG images. |
| GJS (GNOME's JS runtime) | **Rejected**, despite better long-term maintainability (GNOME-backed, no ABI churn). See evidence in §5. |
| Electron / WebView wrapper | Rejected — user wants native GTK only, no web stack. |
| Python + PyGObject / Rust | Rejected — awkward fit for the JS scramble module. **Revisited 2026-10-08:** embedding the module in a Rust JS engine works and is byte-identical across 206 types, so Rust is no longer ruled out on *this* ground — see [RUST-PORT.md](./RUST-PORT.md). Python alone stays rejected (measured ~190× slower). |

**License:** GPL-3.0-or-later (LICENSE file). Required by `cstimer_module` and
permitted for porting
csTimer's GPL source. Compatible with GTK/Libadwaita (LGPL) and node-gtk (MIT).

---

## 3. Architecture

```
src/
├── main.ts              bootstrap: Adw.Application, window, header, actions
├── core/                ★ pure TypeScript — NO `gi:`, NO Node APIs
│   ├── timer.ts          state machine: idle → holding → ready → running → stopped
│   │                     (+ WCA inspection: 15 s → +2, 17 s → DNF, splits)
│   ├── time.ts           formatting, penalty math, DNF-as-∞, inspection clock
│   ├── stats.ts          ao5/ao12/mo3/aoX trimming, best single/avg, PB target
│   ├── session.ts        Solve & Session models, CRUD, undo, penalties, comments
│   ├── sessionLibrary.ts session index rules: names, ids, active, scramble type
│   ├── scrambleTypes.ts  206-type catalogue + 44-group menu (data-driven)
│   ├── scrambleFeed.ts   prefetch state machine: type switch / advance / ready
│   └── preferences.ts    Preferences shape, defaults, per-field validation
├── scramble/
│   ├── worker.ts         worker_threads host for cstimer_module
│   ├── protocol.ts       typed request/response messages worker ↔ main
│   ├── cstimerLang.ts    type-id → cstimer_module language-table mapping
│   └── service.ts        prefetch queue — next scramble is always warm
├── platform/
│   ├── store.ts          atomic JSON persistence in XDG data dir (Node fs)
│   ├── random.ts         CSPRNG seeding (crypto.getRandomValues)
│   └── audio.ts          inspection beeps — pre-rendered C6 WAV pulses played
│                         fire-and-forget: pw-play → paplay → gst → aplay
├── ui/                   GTK widgets only; talks to core via callbacks
│   ├── timerLabel.ts     monospace digits; gray/red/green/white + inspection
│   ├── scrambleTypeButton.ts  header: icon-only type chooser button (J)
│   ├── scrambleTypeTitle.ts   header: Adw.WindowTitle — category / type
│   ├── scrambleTypeSelect.ts  two Gtk.DropDown selectors — UNHOOKED 2026-10-04
│   ├── scrambleTypePicker.ts  shared Adw.Dialog chooser (opened by one button)
│   ├── scramblePanel.ts  scramble text + Gtk.Picture diagram (overlay)
│   ├── timesList.ts      Gtk.ColumnView of solves
│   ├── statsStrip.ts     ao5/ao12 line under the timer
│   ├── statsPanel.ts     statistics (Adw.Dialog)
│   ├── sessionMenu.ts    session radio-menu (Gtk.MenuButton + Gio.Menu)
│   ├── shortcuts.ts      Adw.ShortcutsDialog (built fresh on app.shortcuts)
│   ├── preferences.ts    Adw.PreferencesDialog: Timer / Appearance / Scramble
│   └── stringExpression.ts  makeStringExpression() — string search (decision 10; the
│                         Preferences ComboRow dropped it 2026-10-06, see decision 10)
```

### Why the boundary matters
- `core/` purity makes the timer state machine and stats math testable with
  Vitest without a display server.
- It is also the insurance policy: if node-gtk ever becomes unmaintainable
  (single maintainer, per-Node-major prebuilds), a GJS port would touch only
  `ui/` + `platform/` + `scramble/`, carrying `core/` and its tests untouched.

---

## 4. Key technical decisions

1. **Timing precision** — capture start/stop with `GLib.get_monotonic_time()`
   (µs) inside the key handler, never in the paint callback. Display is just
   formatting an interval, refreshed on a 16 ms `GLib.timeout_add` while
   running. csTimer itself only shows milliseconds, so this is parity.

2. **Hold-space logic** — GTK4 does not expose keyboard auto-repeat, so track
   held keys locally and ignore repeat presses. Configurable hold threshold
   before the timer turns green (csTimer's "time of keeping space down").

3. **Scramble prefetch** — worker thread + queue. Generate the *next* scramble
   while the user is solving so it is ready the instant they finish.

4. **Native layout (not the csTimer webpage layout):**
   - `Adw.OverlaySplitView`: solve list as a sliding sidebar over the content,
     auto-collapsing on narrow windows.
   - Center column: scramble text (monospace, display only — copy lives on
     the header's copy button, `Ctrl+C`) → big timer →
     ao5/ao12 label strip.
   - Two headers (layout F, 2026-10-01): the **sidebar's** header carries
     the app name and the app menu (About / Keyboard Shortcuts / Quit),
     with the session switch as a row under it; the **content** header
     carries the sidebar toggle, the scramble type button (two dropdowns
     until 2026-10-04),
     refresh and an app-functions menu (empty until M4+ fills it).
   - Statistics in an `Adw.Dialog`; settings in `Adw.PreferencesDialog`.
   - `Adw.ToastOverlay` for undo ("Solve deleted [Undo]"), `Adw.StatusPage`
     for the empty state.

5. **`Gtk.ColumnView`, not `Gtk.ListBox`** — ListBox builds every row and a
   session can hold thousands of solves; ColumnView is virtualized.

6. **Storage** — one JSON file per session under `GLib.get_user_data_dir()`,
   atomic write (temp file + rename) after each solve, debounced. Revisit only
   if profiling shows a problem (`node:sqlite` is built into Node).

7. **Where per-solve actions live — the toolbar, not a context menu.**
   Select row(s) and act from the footer bar under the list (a
   `Gtk.ActionBar` revealed on selection); M4 puts `+2`, `DNF`, comment and
   delete there, acting on the whole multi-row selection. Deliberately **no
   `Ctrl+Z`**: a shortcut that *deletes* a record is not intuitive (user
   call, 2026-10-01) — deletions are undone from their toast instead. The
   other csTimer-parity shortcuts stay: `Ctrl+1/2/3` = OK/+2/DNF on the
   latest solve, `Alt+1-7` scramble types.

8. **SVG scramble images** — GTK4 has no SVG support; use `Rsvg-2.0` via GI
   → `Gtk.Picture` (typelib confirmed present on this machine).
   **Superseded 2026-10-08 (user call)**: the machine is on GTK 4.24, and
   `Gtk.Svg` (since 4.22) renders in-process — crisper at any scale, ~2-3×
   faster to load (measured 0.6-2.9ms vs 1.9-8.2ms per image), and it drops
   the Rsvg/GdkPixbuf imports and the `Rsvg-2.0` typelib from
   `generate-types`. The tier caps move into the SVG's rewritten viewport
   (probe: a Gtk.Picture size request only raises the minimum — the
   paintable's intrinsic size wins, so requests cannot enforce the cap).
   Caveat found by probe: a few types (megaminx, FTO, multi-blind relays)
   carry CSS that Gtk.Svg's minimal style support declines — the image still
   renders, with warnings on stderr; visually verify those three.

9. **Wayland** — no global key grabs. Hold-space works only while the window
   is focused (same as csTimer in a browser tab). GlobalShortcuts portal is a
   possible later addition, not in MVP.

10. **Scramble-type selector — two dropdowns, not one searchable list.**
    *Superseded for the header on 2026-10-04* — the header showed one
    ellipsizing button (`scrambleTypeButton.ts`; icon-only with the text in
    an `Adw.WindowTitle` since 2026-10-08) — but the reasoning and the
    search gotcha still stand for any `Gtk.DropDown` holding strings, and the
    Preferences `ComboRow` is one. Mirrors
    csTimer's own two-level menu: 44 categories → plain type names (names are
    unique *within* a group, verified — 0 intra-group duplicates, so no
    `group · name` prefixes needed). GTK search gotcha: `Gtk.DropDown`'s search
    is a no-op unless an `expression` is set — `newFromStrings()` passes NULL
    and `set_enable_search(true)` alone silently does nothing. Setting the
    `expression` *property* from node-gtk aborts the process
    (`Unhandled GValue type: GtkExpression`), so build it in the constructor:
    `Gtk.DropDown.new(model, Gtk.PropertyExpression.new(GObject.typeFromName('GtkStringObject'), null, 'string'))`,
    plus `setSearchMatchMode(SUBSTRING)` (the default PREFIX misses "roux" in
    "3x3x3 Roux"). Swapping a level-2 model from JS resets `selected` → 0 and
    emits `notify::selected`; guard the callback while swapping.
    *Amended 2026-10-06* — only half of this was ever load-bearing. The
    Preferences `ComboRow` no longer sets an expression: rendered side by
    side, with and without, it drew an identical selected label and an
    identical popover (GTK 4.22.5 / libadwaita 1.9.4), so "the default
    factory has nothing to show" was wrong for *display* — what needs the
    expression is *search* (ComboRow: "Search requires
    AdwComboRow:expression to be set"). `tools/prefs_probe.mjs` now asserts
    the label renders, the tripwire for a libadwaita release that stops
    doing it; `stringExpression.ts` stays for the searchable dropdowns
    (shrink_demo A/A2, the unhooked reference selector).

11. **i18n — catalogs are TypeScript modules, not JSON files.**
    `src/locales/en.ts` exports the message table `as const`; every other
    locale is typed `Record<keyof typeof en, Message>`, so an untranslated or
    misspelled key is a **compile error** rather than a raw key rendered in
    the UI. It also keeps `src/core/` pure (rule 1): no `fs`, no JSON loader,
    and `t()` is unit-testable by setting the locale and asserting. Plurals
    go through `Intl.PluralRules` (`one`/`other` for English, `other` only for
    Chinese). The runtime is a module-level locale plus `t(key, params?)` in
    `src/core/i18n.ts` — deliberately *not* a translator object threaded
    through every widget factory, which would touch every call site for no
    testability gain. The language lives in `Preferences` and applies at
    **startup**: headers and menus are built once, so changing it shows a
    "restart to apply" toast instead of a live re-render.

12. **csTimer file compatibility — a pure codec, and what the export must
    contain.** Parsing and serialising live in `src/core/csTimerFormat.ts`
    (pure, round-trip tested); only the file chooser and the toast are UI.
    Two findings from reading csTimer's `export.js` and `lib/storage.js`
    shape the export: `loadData()` runs `localStorage.clear()` when the file
    has a `properties` key, and `storage.importAll()` **overwrites** slots
    `1…sessionN` rather than merging. So the export must carry
    `properties = { sessionN, sessionData }` — omit it and csTimer keeps its
    settings but silently drops every session past *its* current count — and
    importing into csTimer is a **restore**, not an append. csTimer resets its
    own settings to defaults in that case; there is no way to preserve
    settings we were never given, so the confirmation dialog says so. Import
    *from* csTimer is the safe direction and creates one new session per file
    session (`SessionLibrary` already dedupes names).

13. **Statistics growth — one incremental sorted window, not repeated sorts.**
    `bestWindow()` currently sorts every window it inspects; adding ao1000
    would mean ~40 M comparisons over a few thousand solves, and
    `sessionStats()` runs on dialog open, where a 0.5 s freeze is not
    acceptable. M11 rewrites it as an **incrementally maintained sorted window**
    (binary-search insert/remove; `meanWindow` stays the plain-array
    reference implementation the tests speak to). Charts (M12) keep the split
    the rest of the app uses — binning and series math in `core/`, drawing in
    `ui/` — and no Cairo text (rule 6), so axis labels are `Gtk.Label`/Pango
    overlays.

14. **Size preferences scale the tier, they never replace it.** Three new
    preferences — timer readout, scramble text, scramble diagram — each a
    multiplier clamped by `normalizePreferences`. `layoutFor()` takes them and
    applies them to its *own* outputs, so `src/core/layout.ts` stays the only
    file that may hold a threshold (the rule its header already states): the
    tiers keep deciding relative growth and the no-clip invariant, and a
    preference only changes how much of it the user gets. What the scales do
    to each output — timer px = base (72/96/128) × scale;
    `scrambleChars` = base ÷ text scale, because a bigger font fits fewer
    characters in the same width, while `scrambleMaxHeight` (px) × scale
    because the same lines are taller; `diagramMax*` × scale. Two
    implementation notes: the timer's sizes are CSS classes
    (`.timer-display.size-s/m/l`) and GTK4 CSS has no custom properties, so a
    changed scale re-`add()`s that sheet (`styles.add()` returns a handle with
    `remove()`); and `scramblePanel.ts` already duplicates
    `IMAGE_MAX_WIDTH/HEIGHT` on top of the tier's `diagramMax*`, which M7
    removes — a third source of diagram size would be a bug waiting to happen.

15. **Touch is the same input model as the keyboard, not a second one.**
    `Timer` already speaks strings: `keyDown('space', now)` / `keyUp('space',
    now)` is what Space does and `keyDown('escape', now)` is what cancels an
    inspection. A `Gtk.GestureClick` on the timer emits *those same calls*, so
    the hold threshold, the inspection countdown, the +2/DNF grading and the
    "a press while running stops the solve" rule carry over with **no new
    state-machine code and no second set of timings to keep in step**. The
    guards the keyboard path already has must be mirrored — a focused text
    entry owns the press, and press-while-running outranks everything else.
    The same rule reaches the list: long press and swipe drive the selection
    and the delete that Shift/Ctrl-click and right-click drive today, ending
    in the same two-step `remove()`/`restore()` undo toast, so there stays
    exactly one deletion path and one undo. Mouse and touch share
    `Gtk.GestureClick`, which is why this also gives a desktop user
    click-and-hold to start — a behaviour change worth knowing about before
    it ships, not a side effect to discover after.

---

## 5. Research evidence (measured, not assumed)

### System environment (verified on this machine)
| Item | Value |
|---|---|
| GTK4 | 4.22.5 |
| libadwaita | 1.9.4 (has OverlaySplitView, Adw.Dialog, PreferencesDialog) |
| Typelibs present | Gtk-4.0, Adw-1, Rsvg-2.0, Gst-1.0 (full GStreamer), Pango, Gio, GLib |
| Node | v26.10.0 (node-gtk ships a Node 26 prebuild) |
| GJS | 1.88.1 installed (used for the comparison below) |

Nothing needs to be installed before starting.

### `cstimer_module` (v0.1.5, tested locally)
- Full API surface: `getScrambleTypes`, `getScramble`, `setSeed`, `setGlobal`,
  `getImage`. **Scrambles and SVG images only** — no timer, stats, sessions,
  or solvers. The other ~90% of the app is written here.
- Loads in Node in 33 ms, 206 scramble types.
- **Blocking measurements (reason for the worker):**

  | scramble | time |
  |---|---|
  | 3x3 random-state | ~51 ms |
  | 4x4 WCA random-state | **~1194 ms** |
  | 5x5 / 7x7 / clock (random-move) | <1 ms |

- Pure JS, CommonJS bundle, no native deps. Also ships a `postMessage`
  worker protocol in the bundle.

### GJS vs node-gtk (why node-gtk won)
Ran against GJS 1.88.1 installed locally:
- `import cstimer_module` → `ReferenceError: $ is not defined`; with shims →
  `$.isArray` → `$.UDPOLY_RE`. The bundle only takes its clean export path
  under CommonJS; under ESM it expects csTimer's *extended* jQuery. Not a
  config fix — a porting project.
- `typeof Worker === 'undefined'` → no workers, so the 1.2 s 4x4 scramble
  would freeze the GJS main loop with no escape hatch.
- `globalThis.crypto === undefined` → `cstimer_module` would fall back to
  timestamp seeding (weak/predictable scrambles) unless seeded manually.
- Plus: no npm (stackmat needs `serialport`), no stock TS/test tooling.

GJS wins on maintainability (GNOME-backed, no ABI churn, ships with the
desktop); node-gtk wins on capability for this app's dependencies. The pure
`core/` boundary is what keeps the GJS option open.

### node-gtk risks and how this plan dodges them
| Open issue class | Mitigation |
|---|---|
| Segfaults in custom widget subclassing | Stock widgets + CSS only (rule 5) |
| Cairo toy text API broken (`textExtents` returns `{}`) | Pango / `Gtk.Label` (rule 6) |
| GStreamer unref issue | Audio isolated in `platform/audio.ts`; `pw-play` subprocess fallback |
| Memory consumption report | **Checked at M3** (see §6): 10 000 solves cost ≈ +26 MB, scrolling adds nothing |
| Single maintainer / per-Node ABI prebuilds | Pure `core/` keeps a runtime swap cheap |
| Key events eaten by the focused widget (found in M0: the header `MenuButton` swallowed Space, so the timer never saw it) | `EventControllerKey` in **CAPTURE** phase on the window |
| `@dim_label_color` silently renders white in GTK4/libadwaita (found in M0: dim text was invisible) | Dim text with `alpha(@window_fg_color, 0.55)`; stick to `@window_fg_color`, `@success_color`, `@error_color`, `@warning_color` |
| X11 window screenshots go stale under XWayland (found in M0: `XGetImage` kept returning an old frame while the app painted fine) | For visual checks, force a repaint (resize the window) before capturing, and trust tick logs over screenshots for timing |

### csTimer data-file format (read from csTimer's source, 2026-10-05)

Read out of `cs0x7f/cstimer` @master — `src/js/export.js` (writes and loads
the file), `src/js/lib/storage.js` (`exportAll`/`importAll`),
`src/js/lib/tdconverter.js` (the importer's format sniffer). GPL; porting
the *format* is covered by the same "math, not the DOM" rule as the stats.
Not measured on a live csTimer — a real export file is wanted as a test
fixture (see §7) so the spec below is checked against a golden sample rather
than only against my reading of it.

**File = one JSON object.** Top level: `session1 … sessionN` (plain arrays)
plus a `properties` object.

```
sessionK: [ [[penalty, timeMs, …phaseSplits], scramble, comment, dateEpochSecs], … ]
properties: { sessionN: <int>,
              sessionData: "<JSON string of {1:{name, opt:{scrType, phases}, rank}, …}>" }
```

| Field | Rule |
|---|---|
| `val[0]` penalty | `0` = OK, `2000` = +2, `-1` = DNF — verified in three independent converters in `tdconverter.js` (BlockKeeper, TwistyTimer, DCTimer), all writing penalty at index 0 |
| `val[1]` time | **milliseconds**, raw and unpenalised → maps straight onto `Solve.timeMs` + `Solve.penalty` with no arithmetic |
| `val[2…]` | phase splits — we have no field for them; drop and count |
| index 1 / 2 | scramble / comment (empty string, not absent) |
| index 3 | date in **epoch seconds** → `createdAtMs = date * 1000` |
| `sessionData[i].opt.scrType` | csTimer's type id — *already* our id space (`333`, `444wca`, `pyrso`, …); validate against our 206-entry catalogue, fall back to the default |

**Import into csTimer is a restore, and it wipes its settings.**
`export.js:loadData()` does `if ('properties' in data) { localStorage.clear();
… }` before `storage.importAll(data)`; `importAll` then writes
`obj['session'+i]` for `i = 1…kernel.getProp('sessionN')` — so a missing
session key becomes empty rather than being left alone. Consequences:
`sessionN` **must** be present (else sessions past csTimer's current count are
dropped), and csTimer's own settings return to defaults (it shows a delta
confirmation first, and there is nothing we could put in `properties` to stop
it). Import *from* csTimer reads only, so it is the safe direction.

### Rust: embedding the scrambler vs. porting it (researched 2026-10-08)

**Not scheduled** — recorded so the work isn't repeated. Full findings,
numbers and a re-runnable harness: **[RUST-PORT.md](./RUST-PORT.md)** and
`tools/rust-embed/run.sh`.

- Six JS engines (rusty_v8 direct, JavaScriptCore, deno_core/V8,
  edon/libnode, rquickjs/QuickJS, boa) were driven through all 206 types.
  **Every one produced byte-identical output to Node** (dump md5
  `7750f9e8…`), so a Rust app can embed the module rather than port it.
- The host shim is ~10 lines: fake `global`/`process`/`require` so the bundle's
  `isInNode` test passes, plus the two csTimer lang strings. Under real libnode
  no shim is needed.
- **`v8` (rusty_v8) used directly is the recommended engine** — Node-class
  speed (8.1–9.1 s sweep vs Node's 7.5–8.4 s), 8 crates, no tokio, MIT, V8
  statically linked. `deno_core` is the same V8 with an op system and event
  loop on top (322 crates + tokio) — only worth it if you need ops, Promises
  or ES modules. QuickJS/boa are 24×/55× slower and would blow the 1.2 s 4×4
  budget that motivates rule 4.
- **Packaging size** (§5 of RUST-PORT.md): a static-V8 binary is 44.3 MB;
  JavaScriptCore links its C API into a **0.35 MB** binary with zero crates.
  Prefer the `jsc6` flavour — `gnome-shell` depends on `webkitgtk-6.0`
  directly, so on a GNOME desktop it costs no extra download (and it pulls
  gtk4, our own toolkit); the `jsc4` alternative would add a 141 MiB install
  *and* a gtk3. Full table and trade-offs in RUST-PORT.md.
- **Under Flatpak the JSC argument stops being conditional** (RUST-PORT.md
  §5): `gnome-build-meta` ships WebKitGTK with `-DUSE_GTK4=ON` into
  `elements/sdk-platform.bst`, so `libjavascriptcoregtk-6.0` is in both
  `org.gnome.Platform` and `org.gnome.Sdk` — a runtime a GTK4 app needs
  anyway. Zero extra bytes, no `depends`, no `finish-args`; the 6.0 flavour
  is the *only* one the runtime has. Recorded for whenever M15 reopens
  packaging; no work implied now.
- Porting the dependency instead means ~18 900 lines, of which 3 992 are
  GWT-transpiled Java, plus ~600 sites where JS int32 semantics must be matched
  exactly to keep seed parity. Hours vs. weeks.
- `gtk4-rs` 0.11.5 / `libadwaita` 0.9.2 under gtk-rs are actively maintained —
  a Rust rewrite would improve on `node-gtk`'s single-maintainer risk, and the
  `src/scramble/` boundary (318 lines) means the engine swap touches only that
  directory.

---

## 6. Milestones

Each milestone ends with a runnable app.

Blocks are in **execution order, not numeric order**. Milestone numbers are
stable identifiers from here on — they are about to appear in tag messages
and changelog entries, so renumbering (done twice already) is no longer free.
The queue is **M13 → M14 → M15**, then M7–M12 and M16; the landed M0–M6 log
closes the section. A number never moves: only the queue does.

| # | Deliverable | Done when |
|---|---|---|
| **M0** | Scaffold via `npx node-gtk create`; `core/timer.ts` state machine; hold-space timing with µs precision and key-repeat handling | App times accurately; Vitest green on the state machine |
| **M1** | Scramble worker (`worker_threads`) + prefetch queue + scramble panel + scramble-type selector | 206 types, zero UI freezes |
| **M2** | Record solves → `Gtk.ColumnView` → atomic JSON in XDG data dir, restart-safe; undo/delete | A usable timer |
| **M3** | Sessions: create/rename/switch/delete, per-session lists and stats, header dropdown | Multi-session works |
| **M4** | Statistics ported from csTimer rules (ao5/ao12/mo3 trimming, DNF-as-∞, PB target), penalties `+2`/`DNF`, WCA inspection with beeps, per-session scramble type | Feature-complete core |
| **M5** | Preferences dialog, full shortcut set, scramble image (Rsvg), dark-mode theming, empty states/toasts, polish | Something to use daily |
| **M6** | Adaptive layout: `Adw.Breakpoint`-driven drawer sidebar on narrow windows (retiring the "drawer is M5 polish" note), a header that adapts instead of truncating, sidebar width bounds that grow with large windows instead of pinning at 320, timer/scramble that use the space they get | The layout looks deliberate at every window size |
| **M7** | Size preferences: timer readout / scramble text / scramble diagram scales, applied by `layoutFor()` rather than beside it; the duplicated diagram caps unified | A size slider changes the live UI and the 360×294 floor still holds |
| **M8** | Scramble type options: length/count, neutral orientation, pre-scramble, fast alias; case filter documented as blocked upstream | Pick `3x3 mbld`, set 3, get exactly three numbered scrambles — and the control resets on type change |
| **M9** | i18n: `core/i18n.ts` (`t()` + `Intl.PluralRules`), typed catalogs in `src/locales/`, `language` preference, sweep of every existing UI string | Switch to 中文, restart, and the UI reads Chinese |
| **M10** | csTimer JSON import/export: pure `core/csTimerFormat.ts` codec, `Gtk.FileDialog` open/save, `app.importData`/`app.exportData` with `<Ctrl+O>` / `<Ctrl+Shift+S>` | A csTimer file imports into new sessions and exports back out |
| **M11** | Records & statistics: PB history, σ/best/worst/range, ao50/ao100/ao1000, per-day activity, `Adw.ViewStack` tabs in the Statistics dialog, incremental sorted window | The Statistics dialog answers "when did I set that, and for how long?" |
| **M12** | Charts: distribution histogram + time trend, math in `core/`, `Gtk.DrawingArea` in `ui/` | Both charts render and track the session |
| **M13** | Release readiness: version from `package.json`, CHANGELOG, `Adw.AboutDialog` with the right licence and credits, AI-assistance disclosure, user-first README, icon, public name | `git tag v0.x.y` on a repo a stranger can clone and run |
| **M14** | Touch input: `Gtk.GestureClick` on the timer (same `keyDown`/`keyUp` calls as Space), long-press + swipe on the solve list, inspection's missing cancel button, and a re-measure of the 360×360 overlap | A solve starts with a finger, and the floor layout is confirmed clear — or fixed |
| **M15** | Phone runtime evaluation: arm64 Node, node-gtk native binding, audio, input — a verdict, not a port | A written result: a scoped packaging milestone, or "not viable" |
| **M16** | AUR package: PKGBUILD precompiling with Arch's `typescript`, shipping `dist/` + the two npm runtime deps only | `makepkg -si` installs it and `/usr/bin/cstimer-gtk` launches from outside the source tree |

**Post-MVP backlog:** stackmat (§1), then packaging if ever needed.

### M13 — scheduled (release readiness)

Two halves. **A is decision-free and may be pulled forward at any time** —
it is what makes the release publishable; B is gated on the two open
decisions at the end of this block.

**A — versioning, tagging and disclosure**

**Tagging is part of this milestone** (user call, 2026-10-16). The scheme:

- **`0.0.x` = internal stages; `0.1.0` = the first public release**, which is
  what this milestone delivers. The PKGBUILD draft's `pkgver=0.1.0` already
  points at it.
- **Backfill `v0.0.1 … v0.0.7`** onto the seven landings that already
  happened. Their commits are unambiguous — M4/M5/M6 each end in an
  `M# stage N: PLAN … evidence` commit, M1–M3 in a `docs: hand off M#`
  commit:

  | tag | commit | milestone |
  |---|---|---|
  | `v0.0.1` | `234c32e` | M0 · 2026-09-30 — scaffold, hold-space timer, X11 harness |
  | `v0.0.2` | `bdf41f4` | M1 · 2026-10-01 — scramble worker, prefetch feed, panel |
  | `v0.0.3` | `5e5ed19` | M2 · 2026-10-01 — ColumnView list, atomic store, undo |
  | `v0.0.4` | `5ea184f` | M3 · 2026-10-01 — session library, per-session lists |
  | `v0.0.5` | `5768101` | M4 · 2026-10-02 — statistics, penalties, WCA inspection |
  | `v0.0.6` | `7aca698` | M5 · 2026-10-02 — preferences, theming, SVG diagram |
  | `v0.0.7` | `916b5e4` | M6 · 2026-10-02 — adaptive layout, drawer, phone form |

  Annotated, with the message drawn from §6. **Caveat: those seven commits
  still carry `"version": "0.1.0"` in their `package.json`** — the field only
  becomes meaningful from the bump below, and fixing it would mean rewriting
  history.
- **`package.json` `0.1.0` → `0.0.7`**, matching the last backfilled tag. The
  current value is `npx node-gtk create` boilerplate: it arrived with the
  scaffold and no commit touching `package.json` has ever changed it, so
  nothing has consumed it and no history is lost. `0.0.8` is the next stage.
- **`CHANGELOG.md`**, Keep a Changelog: `[Unreleased]` on top, then `0.0.7`
  … `0.0.1` descending, seeded from §6's descriptions. Entries land under
  `[Unreleased]` *as work happens* — writing it all at tag time from `git
  log` produces a changelog, not a good one.
- **Stages are cut when the user calls it**, not automatically at a milestone
  landing: `npm version 0.0.N --no-git-tag-version` → edit the changelog →
  commit → `git tag -a v0.0.N -m …` → `git push --follow-tags`.
- **Milestone numbers never enter a version.** They have been renumbered
  twice already; versions are a monotonic counter, so a renumber can never
  demand a version rewrite.

**Already done — verified 2026-10-16. This block used to describe all of it
as future work:**

- *one version, one place*: `src/platform/meta.ts` reads `package.json`, and
  `main.ts` passes `version: APP_VERSION`. The import-attribute alternative
  stays ruled out — `resolveJsonModule` is off and `rootDir: "src"` rejects a
  file outside `src/`.
- licence enum corrected to `Gtk.License.GPL_3_0` (*or later*), matching
  `package.json`;
- `Adw.AboutWindow` → `Adw.AboutDialog`, which is also what Statistics,
  Preferences and the type picker already use;
- the AI/LLM disclosure present in **both** places, same sentence in each:
  the README's *How this was written* section and the About `comments`.

**Still open in half A:**

- **`package.json` identity** — still `name: cstimer-gtk`, with the
  scaffold's placeholder `description` ("An Adwaita application built with
  node-gtk.") and no `repository` field, days after `Puzzle Timer` was
  adopted. `private: true` stays — a source release is a git tag and a repo,
  not an npm publish.
- **`CHANGELOG.md`** — as above; does not exist yet.
- **About gaps** — `website`, `issueUrl`, `releaseNotes` +
  `releaseNotesVersion`, and `addAcknowledgementSection()` for csTimer /
  `cstimer_module` / node-gtk / GTK / libadwaita are still unfilled.
- **Decide whether the About dialog should publish the developer email** —
  it currently shows `Lu Xu <oliver_lew@outlook.com>`, which is a decision
  once the repo is public.
**B — gated on two open decisions**

- **Public name**, cheapest to most irreversible:
  - **Adopted 2026-10-07: `Puzzle Timer`.** The repo is
    `github.com/xlucn/puzzle-timer` (SSH: `git@github.com:xlucn/puzzle-timer.git`),
    which takes the shortlist's preferred option and closes the "final call"
    §7 was carrying — the runner-up, `Inspection`, is dropped. The *Chinese*
    name is still open (see below). The shortlist and its evidence stay,
    because that is what the decision rests on: judge names against the GNOME
    HIG app-naming rules
    (<https://developer.gnome.org/hig/guidelines/app-naming.html>):
    one or two simple nouns, under 15 characters, easy to pronounce, easy to
    draw as an icon — and avoid puns and inside jokes, made-up words,
    acronyms, decorative punctuation, and other projects' names.
    - **`Puzzle Timer`** — 12 chars, two simple nouns (the *Text Editor*
      pattern), passes every rule, and **nothing on Flathub has the name**.
      It also fits the cubing community's own `…Timer` convention (csTimer,
      Twisty Timer, CubeTimer, qubetimer, opentimer), and it is *more*
      on-domain than *Cube Timer*, because the catalogue is 206 puzzle
      types — pyraminx, megaminx, skewb, clock, square-1 — not just cubes.
      One caveat to design around: "puzzle" reads as jigsaw to outsiders,
      so the icon must be a cube and the AppStream summary must say
      speedcubing.
    - **`Inspection`** — 10 chars, the official WCA term for the 15 s,
      free on Flathub, and the *Celluloid* school of name. Held back
      because it is a **common word in development tooling**: GHex
      ("Inspect and edit binary files"), Sonar ("Inspect and debug
      webhooks"), Color Profile Viewer, DevTools inspectors — easy to
      confuse with unrelated apps. Good name, weaker identity.
    - Discarded while searching: **`Cube Timer`** (two Flathub apps
      already — `io.github.vallabhvidy.CubeTimer`, GTK4/libadwaita,
      "inspired by cstimer.net", and `xyz.aguno.CubeTimer`);
      **`Scramble`** (`io.github.tobagin.scramble`, a verified Flathub app
      on our own stack — Vala/GTK4/libadwaita, GPL-3.0-or-later);
      **`Scrambled`** (free, but a participle rather than a simple noun,
      and it reads as eggs); **`Twenty`**, **`Trim`**, **`Stickerless`**
      (puns or insider vocabulary); **`gtkimer`**, **`Kubo`** (made-up
      words).
  - **The Chinese name is chosen freely, never translated** (user call,
    2026-10-05). Literal translation is what makes bilingual names fail:
    Inspection → 检查 (bureaucratic), Scrambled → 打乱的 (an accident),
    Trim → 修剪 (pruning), Stickerless → 无贴纸. Ship a *pair* the way
    WeChat/微信 does — the Latin brand plus a Chinese name picked as a
    Chinese name — rendered through `t('app.name')`, `.desktop`
    `Name[zh_CN]=`, and AppStream `xml:lang`. Candidates offered and not
    yet chosen: 屏息 (hold your breath) and 谜面 (the surface of a riddle)
    for the shortlisted English names, plus 蓄势, 玄机, 错落, 未解,
    分秒, 还原.
  - `APP_NAME` (`'csTimer GTK'`) is display only — window title, menus,
    sidebar, About. Free to change, any time — and it now has a target,
    `'Puzzle Timer'` (under M9 it becomes `t('app.name')` either way).
  - `package.json.name` — free, and should become `puzzle-timer` to match the
    repo. The file also still lacks a `repository` field and still carries the
    scaffold's placeholder `description`, both of which the repo now makes
    easy to fill in.
  - **App id** — `APP_ID = 'com.oliver.cstimergtk'` (note it already
    differs from the package name `cstimer-gtk`): it is the About
    `applicationIcon`, the `.desktop` filename and the `WM_CLASS`. Settle it
    *before* the first tag; afterwards changing it is a migration.
  - **XDG data dir — do not change.** `store.ts` hardcodes
    `APP_DIR = 'cstimer-gtk'` and the sessions live in
    `~/.local/share/cstimer-gtk`. Renaming the app must not silently repoint
    that at an empty directory: either leave it alone, or add a one-time
    migration that renames the old directory when the new one is absent.
- **Icon.** *(Direction decided 2026-10-05; artwork not yet in the repo — it
  still needs the plumbing listed at the end.)*
  - **Metaphor: a 3×3 cube, alone — no timer element.** The name carries
    "Timer" (the HIG wants one simple metaphor), and anything overlapping the
    cube breaks the silhouette at 32 px.
  - **State: PLL Ga**, yellow on top, green front, orange right — *computed,
    not drawn*: a generator rotates stickers in 3D from solved, so the picture
    cannot disagree with the algebra. Verified by move order-4 self-tests, an
    "only the U layer moved" integrity check, a corner 2-cycle + edge 4-cycle
    with matching parity (the G-perm structure), the Ga/Gc recognition
    signature (headlights with an **adjacent** colour between them, not
    opposite), and two independent published Ga algs whose inverses yield the
    same state. A third listed alternative disagrees even after a whole-cube
    rotation — recorded as an unresolved source question, not folded into the
    render.
  - **Projection: 25° elevation, not true isometric (35.264°).** A lower
    camera shrinks the flat top and grows F and R: yellow drops from 17.3 %
    of the icon to 13.6 %, and the silhouette gets squarer (376×400 of 512,
    against 346×400). Scale is fitted to the projected bounding box rather
    than hard-coded, so the visual weight holds at any angle — and the
    default still reproduces the isometric render exactly (checked by pixel
    sample, not by eye).
  - **Shading and finish** (HIG: top lighter, front darker): U 1.0 / F 0.93
    / R 0.86, flat colours on flat surfaces, no gradients, no shadows outside
    the silhouette, ~2 px sticker gaps on HIG's 2 px grid.
  - **32 px finding:** the silhouette still reads as a cube, but the permuted
    top band smears — the Ga detail is a 64/128 px feature. Accept that, or
    have the symbolic variant carry the message.
  - **Still open:** baseline alignment against HIG `template.svg`, the
    **symbolic variant** the HIG requires, and the icon name.
  - **Generator:** the state and the SVG come from one rerunnable script,
    `tools/icon/ga-icon.mjs` — plain Node, no `gi:`, no display, so it runs
    headless like the rest of `tools/`:
    `node tools/icon/ga-icon.mjs [out.svg] [elevationDegrees]`. It defaults
    to writing `ga-cube.svg` beside itself. Its **output is not committed
    yet** — the artwork lands with M13, along with the icon name.
  - **Plumbing:** a scalable SVG, `Gtk.IconTheme.add_search_path()` into the
    repo (a source checkout has no install prefix to drop hicolor icons
    into), a `.desktop` file with `Icon=`, and the icon name in `main.ts`.
    AppStream `metainfo.xml` belongs to packaging, which stays out of scope.
    Until then the About dialog asks for `applicationIcon: APP_ID`, which
    resolves to nothing, so it shows the generic icon — either drop that
    property or point it at the chosen icon name.

**Release checklist**

1. `npm run typecheck`, `npm test`, and the three probes
   (`scramble_probe`, `prefs_probe`, `breakpoint_probe`) all green.
2. README screenshots, taken by the user — AGENTS.md: the agent does not
   take screenshots; the nested-display recipe is in `tools/README.md`.
3. Version bumped, CHANGELOG section written, `git tag vX.Y.Z`.
4. `LICENSE`, README and About all read **GPL-3.0-or-later**.
5. Grep the tree for absolute paths, hostnames and anything else that is
   yours rather than the project's.
6. Confirm `.gitignore` keeps `node_modules/` (and the generated
   `node_modules/.node-gtk-types/`) out of the tag.

**Checkpoint for the user:** clone into a clean directory, read the README
as someone who has never seen the app, then run it and open About — name,
version, licence and credits should all be right, and the disclosure should
read the way you want it to.



### M14 — scheduled (touch input, and the narrow-window leftovers)

Desktop-verifiable with the harness that already exists — no touch device
needed (testing note below). The governing decision is 15: touch mirrors the
keyboard rather than becoming a second input model.

**A — touch**

- **The timer.** `Gtk.GestureClick` on the timer widget: press →
  `timer.keyDown(START_KEY, nowMs())`, release → `timer.keyUp(START_KEY,
  nowMs())` — the exact string `keyId()` produces for Space, so
  `core/timer.ts` is untouched. Mirror the keyboard path's two guards: a
  focused text entry owns the press (the check `key-pressed` already makes),
  and a press while `state === 'running'` stops the solve ahead of everything
  else (the `wasRunning` branch).
- **Mouse gets it too.** `GestureClick` reports pointer and touch alike, so
  click-and-hold on the timer would start a solve where today only Space
  does. Decision 15 says that is wanted — say so in the changelog rather
  than letting it arrive as a surprise.
- **Inspection has no way out without a keyboard.** Escape is the only
  cancel for the 15 s countdown and there is no button. Add a control that
  exists *only* while inspecting, calling `timer.keyDown('escape',
  nowMs())`.
- **The solve list** (`timesList.ts`):
  - `Gtk.GestureLongPress` on the `Gtk.ColumnView` → select the row under
    the finger and reveal the footer. Pointer multi-select is Shift/Ctrl-click,
    which a phone does not have.
  - While that mode is on, a plain tap toggles membership instead of
    replacing the selection — a flag in front of `Gtk.MultiSelection`, not a
    second selection model.
  - `Gtk.GestureSwipe` left → delete, straight into the existing
    `remove()` → undo toast → `restore()` path. No new deletion path.
- **Probe both risks before writing UI.** (1) Gesture competition: a
  `ColumnView` already owns click/selection gestures, and GTK gesture groups
  make a losing gesture *fail* rather than let both fire. (2) Swipe vs.
  kinetic scroll: it needs `|dx| ≫ |dy|` plus a travel threshold, or the
  scroll swallows every swipe. A `tools/*_probe` for each, before code.
- **Testing note:** XTEST already supplies this — button-down, sleep,
  button-up is a long-press; button-down plus motion is a swipe. No touch
  device, no portal, no screenshots. AGENTS.md's keybindings rule is about
  *driving* the app and keeps standing; it never said what input the app may
  accept.
- **Audit: every action needs a touch path.** Almost all have one already
  (footer Edit/Delete, every menu, the header toggles). The gaps:
  `Ctrl+1/2/3` grading has no button — it stays reachable through Edit →
  the penalty group (radios until 2026-10-10, now an `Adw.ToggleGroup` in an
  `Adw.ActionRow`), which is enough — and Escape's jobs: closing dialogs
  and the drawer both have visible equivalents already, inspection does not.

**B — the narrow window still owes one fix**

- **360×360 overlap — re-measure before fixing anything (2026-10-06).** The
  old explanation died with the nudge: `timerMargins`, `NUDGE_SLACK` and
  `phoneFormFor` were deleted on 2026-10-05, so the timer is now **centred at
  all times** and nothing steps aside for the picture. What the source still
  says: at the floor `scrambleMaxHeight` is **100** (h ≤ `shortMax` 620) while
  `diagramMaxHeight` stays **150** (`roomy` is false, so it never steps down),
  and the picture is a `Gtk.Overlay` child anchored bottom-right with 16 px
  margins — overlay children are not counted in the parent's size request, so
  where it lands relative to the timer is decided by GTK's allocation, not by
  anything readable off the source. §7's "still overlaps the timer" was
  measured **while the nudge existed**, and lifting the timer was what put it
  in the picture's way — so dropping the nudge may already have fixed it.
  `[layout] diagram WxH` logs size, not position, so this needs one real look
  at the floor before any work is scheduled: it may be a non-issue. **If** it
  still collides, the fix belongs in the tier (the smallest tier sheds or
  shrinks the diagram) and, per decision 14, must arrive **through
  `layoutFor()`**, never as a constant in `src/ui/` — and it has to compose
  with M7's `diagramScale`, so do it *after* M7.
- **Re-check the startup-only `AdwToastOverlay exceeds …` warning.** Its
  stated cause (a first frame measuring the selectors before any tier ran)
  went away with `headerSlack` on 2026-10-04 — so either it is gone and the
  note closes, or it is something else and now has a name.
  *(Closed 2026-10-15: it has a name — the content-min-vs-floor family in
  §7 — and the floor run boots clean: zero warnings from start through
  four resizes.)*
- **Dialog audit at the floor, both orientations:** Statistics, the type
  picker, the keyboard reference, rename/delete, and the edit dialog at
  **360×640** (portrait phone) and **640×294** (landscape phone — tier B
  drawer, timer `s`, `scrambleMaxHeight` 100).

**Checkpoint for the user:** click-and-hold the timer and release to start,
with no keyboard anywhere near it; swipe a row to delete and undo from the
toast; then resize to the 360×294 floor and confirm the diagram is off the
digits.

### M15 — scheduled (phone runtime — an evaluation, not a port)

A decision gate. Nothing here may change the architecture on its own.

- **The four questions.** Is there an arm64 Node ≥ 20.6 that runs `tsx` +
  `node-gtk`; does node-gtk's native binding build against the phone's GTK 4
  / libadwaita typelibs (it ships prebuilds for desktop Node majors only);
  does audio find a path (`pw-play` → `paplay` → `gst` → `aplay`, all
  desktop assumptions in `platform/audio.ts`); and how much of `tools/`
  survives when the target is Wayland with no Xephyr and no XTEST.
- **Not in scope here:** packaging itself, AppStream metainfo, a Flatpak
  manifest. Those become a milestone only if this reports yes.
- **Deliverable:** a written verdict in §6 with a *scoped* packaging
  milestone attached, or a documented "not viable" that lets the packaging
  line in §1 stay closed.

**Checkpoint for the user:** the verdict.

### M7 — scheduled (size preferences)

Small and self-contained — deliberately the first thing scheduled (user call,
2026-10-05). Decisions: three scales, applied by the tier (decision 14).

- **Fields** — three multipliers on `Preferences`, default `1`, each clamped
  in `normalizePreferences` with a test alongside it: `timerScale` (the
  readout, base 72/96/128 px per tier), `scrambleScale` (the scramble text,
  base 18 px), `diagramScale` (the picture, tier caps 440×150 → 560×190).
  Range 0.75–1.5 (the diagram 0.5–1.5), step 0.05, shown as `Adw.SpinRow`s in
  a new **Sizes** group on the Appearance page — the same row pattern as
  Hold time.
- **Plumbing** — `layoutFor(width, height, sizes)` applies them to its own
  outputs: timer px = base × `timerScale`; `scrambleChars` = base ÷
  `scrambleScale` (a bigger font fits fewer characters in the same width)
  with `scrambleMaxHeight` × `scrambleScale`; `diagramMax*` ×
  `diagramScale`. `src/core/layout.ts` keeps its "no threshold outside this
  file" rule intact — nothing in `src/ui/` learns a size.
- **Applying** — a size change rides the existing `applyPreferences()` path
  and re-runs `applyLayout()`, so the timer, the scramble and the diagram
  re-measure in one pass rather than one each.
- **CSS** — the readout is `.timer-display.size-s/m/l` at fixed px and GTK4
  CSS has no custom properties, so a changed scale re-`add()`s that sheet and
  drops the old one (`styles.add()` hands back a handle with `remove()`).
  Confirm swapping sheets live does not flicker.
- **Unify the diagram caps** — `scramblePanel.ts`'s `IMAGE_MAX_WIDTH/HEIGHT`
  and the tier's `diagramMaxWidth/Height` are the same numbers written twice
  today; one of them goes before a scale can make them disagree.
- **What must still hold:** the 360×294 floor, the drawer at ≤800, the
  selector row at ≤540 — none of them may acquire a size constant of its own.

**Checkpoint for the user:** at default scale, the floor still reports
`360x294` with no app warnings; then push each scale to an end and confirm at
900×540 that the digits read the size asked for and the diagram still clears
the timer.

### M8 — scheduled (scramble type options)

Added 2026-10-10 — csTimer's per-type scramble options. **Independent of every
other milestone**: it needs nothing from them and none of them needs it, so it
can be picked up whenever.

**What csTimer offers** (read out of `src/js/scramble/scramble.js`): the
options popover beside the type selector holds the **scramble length**
(`scrLen`, enabled by `scrdata[..][2] > 0` — the same test as our
`defaultLength > 0`) and the **case filter** (`scrFlt`, checkboxes over
`getExtra(type, 0)`); the same file registers `scrNeut` (neutral orientation
`n/1/2/6`), `preScr` (training rotations) and `scrFast` (aliases `444wca` →
`444m`). There is **no `scrLen` property** in that registration list — the
length is re-read from the type's `scrdata` entry whenever the type changes
and is never saved.

**What `cstimer_module` can reach.** `getScramble` forwards every argument
verbatim — `scramblers[type].apply(scramblers[type], arguments)` — so the
callback is csTimer's own `(type, len, state, neutLevel)`:

- ✅ **length / count** — measured on this machine: `getScramble('r3ni', 2)`
  returns two numbered scrambles (`1)` `2)`) and `3` returns three, so for
  MBLD `len` *is* the number of scrambles; `getScramble('333o', 10)` returns
  ten moves (25 → 25), so for random-move types it is the move count. Our
  pipeline already carries it end to end — `main.ts` → `scrambleLength(type)`
  → `service.scramble(type, length)` → `protocol { length }` → the worker.
  **Only the control is missing, not a single wire.**
- ✅ **neutral orientation** — the 4th argument. Needs a probe that the
  bundled scrambler honours it: same seed, `333` with `n`/`1`/`2`/`6`, and
  the outputs must differ.
- ✅ **pre-scramble rotations** and the **fast alias** — pure text on our
  side, no module involvement.
- ❌ **case filter — blocked upstream, not a bug.** `getExtra` and
  `scrMgr.rndState` are bundle-internal; the module exports exactly five
  functions (`getScrambleTypes`, `getScramble`, `setSeed`, `setGlobal`,
  `getImage`) and `setGlobal` is just `kernel.setProp`. Doing it properly
  needs an upstream export, or a faithful re-implementation of the
  case-filter tables. Recorded here so nobody re-opens it as a defect.

**Design calls (user, 2026-10-10):**

- **Scope: everything reachable** — length/count, neutral orientation,
  pre-scramble and the fast alias; the case filter stays blocked.
- **The length resets on type change**, mirroring csTimer exactly: it is
  re-read from the type's `defaultLength` whenever the type changes and is
  **not persisted** — so no `Preferences` field and no `SessionEntry` field.
  Anyone adding one later is working against this call.
- **Only types with `defaultLength > 0` show the control** — the same test
  csTimer uses to enable `scrLen`. That covers MBLD (`r3ni`, 5), the relay
  `r3` (5), `easyc`/`easyxc` (3/4) and every random-move type.

**Where it lives:** the type-picker dialog is the natural home — csTimer puts
it beside the selector, and that dialog is already where the type is chosen.
Changing it must invalidate the **prefetched** scramble too, not just the
visible one (`src/core/scrambleFeed.ts`), or the next solve starts on a
scramble generated with the old length.

**Checkpoint for the user:** pick `WCA > 3x3 mbld`, set the count to 3 and
get exactly three numbered scrambles; switch to `3x3x3` and watch the control
reset and disappear (`333` has `defaultLength: 0`).

### M9 — scheduled (i18n)

Order settled 2026-10-05: i18n goes **before every string-heavy feature**
(M10 and M11), so those are written translated instead of swept afterwards.
M8 (scramble options) sits *ahead* of it — pulled forward 2026-10-10 — so
its handful of new labels are swept by this milestone rather than born
translated. That is deliberate: M8 is small enough that sweeping it costs
nothing, and waiting behind i18n would have delayed it for no gain.

- **Runtime** — `src/core/i18n.ts` (pure: no `gi:*`, no Node): `setLocale(tag)`,
  `t(key, params?)`, plurals via `Intl.PluralRules`, `formatCount()` and
  `formatDate()` wrappers. A module-level locale, not a translator object
  passed to every widget factory (decision 11).
- **Catalogs** — `src/locales/en.ts` (`as const`, source of truth) and
  `src/locales/zh-CN.ts` typed `Record<keyof typeof en, Message>` so the
  compiler lists every missing translation. Key style: dotted by area
  (`menu.*`, `prefs.*`, `stats.*`, `transfer.*`).
- **Preference** — `language: 'system' | 'en' | 'zh-CN'` on `Preferences`,
  validated in `normalizePreferences` with a test; default `system`, resolved
  once in `main.ts` (before anything builds UI) and passed to `setLocale`.
  Changing it → "restart to apply" toast.
- **Sweep** — every literal in `src/ui/*`, plus `src/main.ts`'s menus,
  toasts and tooltips, plus `src/ui/shortcuts.ts`. Scramble *group* names
  (44) get translated; the 209 type names stay English for now.
- **Timestamps stay as they are** — `formatTimestamp`/`formatFullTimestamp`
  are deliberately compact and numeric (already locale-neutral, and the list
  column is narrow); `Intl.DateTimeFormat` is used for the new PB-history
  dates in M11, where there is room.
- **Probe first** — does GTK's own "Open"/"Cancel" localise under node-gtk?
  node-gtk never calls `setlocale`/`bindtextdomain` (grepped, no matches), so
  stock widget strings may stay English regardless of our catalogs. If so,
  that is a documented limitation of a handful of labels, not a blocker.

**Checkpoint for the user:** switch Language to 中文, restart, read back the
sidebar app menu, the app-functions menu, Preferences and Statistics.

### M10 — scheduled (csTimer import/export)

- **Codec** — `src/core/csTimerFormat.ts`: `parse(text) → { sessions, warnings }`
  and `format(sessions) → text`, following §5's format table exactly.
  Round-trip tests are the point of the file.
- **Import mapping** — penalty `0/2000/−1 → absent/'plus2'/'dnf'`;
  `date × 1000`; the session's `scrType` applied to every solve (validated
  against the catalogue, else the default); names truncated to 40 and deduped
  by `SessionLibrary`; comments truncated to 500 (**`MAX_COMMENT_LENGTH`** —
  a longer one passes our parser but is then rejected by `isSolve` on the
  next load and would vanish silently); phase splits dropped and counted.
  Sessions ordered by `rank`, each created via `SessionLibrary.create()` and
  seeded straight into `Session` + `scheduleSave()`.
- **Export** — all sessions, `properties = { sessionN, sessionData }`, with
  the restore/settings caveat stated in the confirmation (decision 12).
- **UI** — `app.importData` / `app.exportData` on the app-functions menu,
  `<Ctrl+O>` / `<Ctrl+Shift+S>` (both free as of 2026-10-05; verify with
  `Gtk.acceleratorParse`), entries in `Adw.ShortcutsDialog`.
- **Probe first** — `Gtk.FileDialog.open/save` are typed
  (`node_modules/.node-gtk-types/Gtk-4.0.d.ts:25093`, `open`/`openFinish`,
  `save`/`saveFinish`) and `AsyncCallEnvironment` looks like exactly the
  machinery a GIO async callback needs, but no one here has called one.
  Fallback is `Gtk.FileChooserNative`.

**Checkpoint for the user:** import a csTimer file and watch the sessions
appear; export it back and open the result in csTimer.

### M11 — scheduled (records and statistics)

- **`core/stats.ts`** — add `ao50`, `ao100`, `ao1000` to `SPECS` (the trim
  rules stay csTimer's `[1,1]`), spread (σ over finite effective times,
  best/worst/range — cross-check csTimer's `timestat.js` while implementing),
  and the incremental sorted window of decision 13.
- **`core/records.ts`** (new) — `pbHistory(solves, kind)` →
  `{ value, setAtMs, solveId, heldUntilMs | null }[]`. Strict improvement
  only; DNF is ∞ so it can never be a record (and an all-DNF session is
  handled the way `bestWindow` already handles it); a window can improve
  without a new single, so both are tracked.
- **`core/activity.ts`** (new) — local-day buckets, current and longest
  streak, best day, rolling counts. Day boundaries come from `Date` getters
  (local time, no `gi:`/Node needed).
- **`ui/statsPanel.ts`** — `Adw.ViewStack` + `Adw.ViewSwitcher` tabs:
  Summary (today's table), Records, Activity. Charts tab arrives with M12.
- **`ui/statsStrip.ts`** and the list's ao5/ao12 columns are **unchanged** —
  the new windows are dialog-only.

**Checkpoint for the user:** the Records tab dates and "held for" figures
against what you remember of your own PBs.

### M12 — scheduled (charts)

- **Math in `core/`** — distribution bins and trend series, ported from
  csTimer's `src/js/stats/distribution.js` and `src/js/stats/trend.js`
  (GPL: port the math, attribute in the About dialog alongside the existing
  stats attribution).
- **Drawing in `ui/`** — `Gtk.DrawingArea` + a `draw`/`setDrawFunc` callback,
  Cairo line and path drawing only. **No Cairo text** (rule 6): axis labels
  are `Gtk.Label`/Pango overlays positioned by the widget layout.
- **Probe first** — `setDrawFunc` and a Cairo path under node-gtk have never
  been exercised here either.

### M16 — scheduled (AUR package)

Opened 2026-10-06 — the one exception to the packaging line in §1. **Blocked
on M13**: a package needs a name, an icon, a `.desktop` file, and a tag for
`source=()` to point at.

**Second blocker, noted 2026-10-07: the repo is private.** `makepkg` fetches
every `source=()` entry over plain HTTP, so
`github.com/xlucn/puzzle-timer` as it stands is unbuildable for anyone but
its owner — and for you too, inside a clean chroot or a container that has no
SSH keys. M16 needs the repo **public at tag time**, or the release tarball
hosted somewhere public. Make that call deliberately before submitting, not
discovered at submission; note that it cuts against the reason the repo is
private.

**What Arch already has** (queried with `pacman -Si`, 2026-10-06, all in
[extra]): `typescript` 6.0.3 (23.21 MiB), `esbuild` 0.28.2 (11.09 MiB — the
same version as our `allowScripts` pin), `node-gyp` 13.1.0, `nodejs` 26.10.0,
`npm` 12.2.0. **Packaged nowhere — official repos *or* AUR:** `node-gtk`,
`cstimer_module`, `tsx`, `vitest`, `@types/node`. So `typescript` becomes a
`makedepends`, and precompiling is what keeps `tsx` and its 11 MiB of esbuild
out of the package entirely.

**Three size levers**, measured against today's **39 MiB**
`npm install --omit=dev` tree:

1. **Precompile.** `typescript` (23 MiB), `esbuild` (11 MiB), `vitest`,
   `cross-env`, `tsx` and `src/` (476 KiB) never enter the package — they are
   shared system packages or build-time only.
2. **Prune node-gtk's build closure — 26.7 MiB of the 39.** `node-gtk`
   declares `node-gyp` **and** `@mapbox/node-pre-gyp` as *production*
   dependencies, so `--omit=dev` dutifully ships npm's internals (`cacache`,
   `@npmcli/*`, `tar`, `glob`, `nan`, …) — **113 non-dev packages in the
   lockfile**. Once `lib/binding/node-v147-linux-x64/node_gtk.node` is in
   place none of it is needed: `lib/native.js` only reaches
   `require('@mapbox/node-pre-gyp')` *inside*
   `if (!fs.existsSync(bindingPath))`. What stays: `node-gtk/lib` 12 M
   (almost all of it the binding) plus `cstimer_module` 288 K, which has zero
   dependencies.
3. **Ship neither `tools/` nor tests.** `tsconfig.json` has
   `include: ["src/**/*.ts"]` and **no `exclude`**, so `npm run build` emits
   all **9 `*.test.ts` files** into `dist/` (measured: 39 `.js`, of which 9
   are `.test.js`), each importing `vitest`. Add
   `"exclude": ["**/*.test.ts"]` — or delete them in `package()`.

**Verified so far:** `npm run build` is clean under tsc 5.9.3, and all three
runtime paths resolve from `dist/` — `dist/platform/meta.js` imports and
returns `APP_VERSION` (its `../../package.json` reaches the root from `src/`
*and* `dist/`), `dist/main.js` carries `new URL('../style.css', …)`, and
`dist/scramble/service.js` still branches `.ts` → `.js`, so it picks
`worker.js`. **Not verified:** running the built output, and compiling with
Arch's `typescript` **6.0.3** against a project declared `^5.5.0` — that gap
is the first thing to test.

**Two gotchas, both measured:**
- The binding path is ABI-specific (`node-v147-linux-x64`), so an Arch
  `nodejs` major bump breaks the package until a `pkgrel` rebuild.
- `--import node-gtk/register` resolves a bare specifier **from the cwd** —
  it works from the repo root and fails `ERR_MODULE_NOT_FOUND` from `/tmp`.
  The `/usr/bin` launcher must `cd` into the app directory.

**Draft PKGBUILD** (untested against Arch's tsc):

```bash
# Maintainer: Lu Xu <oliver_lew@outlook.com>
pkgname=cstimer-gtk
pkgver=0.1.0
pkgrel=1
pkgdesc="Native GTK4/libadwaita speedcubing timer in the spirit of csTimer"
arch=('x86_64')
url="https://github.com/<you>/cstimer-gtk"        # ← needs M13's public name
license=('GPL-3.0-or-later')
depends=('nodejs' 'gtk4' 'libadwaita' 'gobject-introspection')
makedepends=('typescript' 'npm' 'node-gyp' 'gcc' 'make' 'python')
source=("$pkgname-$pkgver.tar.gz::$url/archive/refs/tags/v$pkgver.tar.gz"
        'cstimer_module-0.1.5.tgz::https://registry.npmjs.org/cstimer_module/-/cstimer_module-0.1.5.tgz'
        'node-gtk-4.1.1.tgz::https://registry.npmjs.org/node-gtk/-/node-gtk-4.1.1.tgz'
        'node-types-node.tgz::https://registry.npmjs.org/@types/node/-/node-<exact>.tgz')
b2sums=('…')

prepare() {
  cd "$pkgname-$pkgver"
  # lockfile-pinned; no scripts — we compile node-gtk ourselves below.
  npm ci --omit=dev --ignore-scripts
  # Arch doesn't package @types/node, and tsconfig sets "types": ["node"]
  mkdir -p node_modules/@types/node
  tar -xf "$srcdir/node-types-node.tgz" -C node_modules/@types/node --strip-components=1
}

build() {
  cd "$pkgname-$pkgver"
  tsc -p tsconfig.json                     # Arch's typescript, not npm's
  ( cd node_modules/node-gtk && npx --no-install node-pre-gyp \
      install --fallback-to-build )        # → lib/binding/node-v147-…/node_gtk.node
}

package() {
  local d="/usr/lib/$pkgname"
  cd "$pkgname-$pkgver"
  install -d "$pkgdir$d/node_modules" "$pkgdir/usr/bin"
  cp -r dist package.json style.css "$pkgdir$d/"
  cp -r node_modules/cstimer_module "$pkgdir$d/node_modules/"
  cp -r node_modules/node-gtk/lib node_modules/node-gtk/package.json \
        "$pkgdir$d/node_modules/node-gtk/"
  install -Dm644 LICENSE "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
  # .desktop + icon + metainfo land here with M13
  printf '#!/bin/sh\ncd %s && exec node --import node-gtk/register dist/main.js\n' "$d" |
    install -Dm750 /dev/stdin "$pkgdir/usr/bin/$pkgname"
}
```

Pragmatic note: `npm ci` inside `prepare()` fetches the network, which Arch's
guidelines prefer to avoid (everything should be in `source=()`). The clean
alternative is listing every tarball — but node-gtk's production closure alone
is 113 packages, so start pragmatic and tighten later if it bothers you.

**Checkpoint for the user:** `makepkg -si`, then launch `/usr/bin/cstimer-gtk`
from a directory that is *not* the source tree.

### M0 — landed 2026-09-30

Scaffold at the repo root (`npx node-gtk create .`, app id `com.oliver.cstimergtk`),
plus `src/core/timer.ts` (5-state machine — idle → holding → ready → running →
stopped — with auto-repeat dedup living in core so it is testable),
`src/core/time.ts`, `src/ui/timerLabel.ts` and the wiring in `src/main.ts`.
`src/welcome.ts` from the scaffold was removed. **22 Vitest tests green.**

Verified by driving the real app with synthetic X11 keys (python ctypes + XTest):
all five states painted correctly (red "Keep holding…", green "Release to start",
dark counting value, frozen result, dim idle), and the 16 ms tick beat steadily
from 17 ms to 1481 ms with the stopped result matching the last beat.
Two M0 bugs were found and fixed this way — see the risk table in §5. The
harness that did it now lives in [`tools/`](./tools/README.md), so later
milestones can re-verify the same way.

### M1 — landed 2026-10-01

Scramble worker (`src/scramble/worker.ts`, `worker_threads` + `cstimer_module`
v0.1.5) behind a typed protocol, `service.ts` request queue, and a pure
`src/core/scrambleFeed.ts` state machine that keeps the next scramble warm and
hands it over the instant a solve finishes (also regenerates on type switch and
on refresh). UI: `src/ui/scramblePanel.ts` (scramble text, "Generating…"
spinner) and the two-dropdown selector `src/ui/scrambleTypeSelect.ts` —
category → type, both searchable (see decision 10 in §4 for the GTK
`expression` pitfall that made search silently do nothing). *Both dropdowns
were unhooked 2026-10-04 in favour of one ellipsizing header button; the
module is kept and the pitfall still applies to any string row with search
on (the Preferences ComboRow keeps search off, and dropped its expression
2026-10-06 — decision 10).*

Evidence:

- `node --import tsx tools/scramble_probe.ts --quiet` → **206/206 types
  generate** (slowest `444bld` 1.79 s — runs in the worker, not the UI thread).
- **40 Vitest tests green** (timer 22 + scrambleFeed + two-level scrambleTypes).
- **Zero freezes, measured:** synthetic keys ran hold-space 0.35 s → release →
  stop at 0.40 s and the timer displayed exactly **0.40** — the main thread
  never stalled; the scramble advanced after the solve.
- Manually verified: type switch (4x4x4) generates without blocking, refresh,
  long relay scramble doesn't resize the window, category/type dropdowns both
  search (`roux`, `pyra`).

### M2 — landed 2026-10-01

Solve recording: `timer.onSolved` reads the scramble that was on screen,
writes `{timeMs, scramble, scrambleType, createdAtMs}` into
`src/core/session.ts` (chronological, **ids never reused**), then advances the
feed. UI: `src/ui/timesList.ts` — a `Gtk.ColumnView` sidebar (never
`Gtk.ListBox`: sessions reach thousands of solves) whose model is a
`Gtk.StringList` of solve *ids* newest-first, rebuilt in one `splice()` per
change; cells read their text from the session in `bind`, so a delete (and the
undo toast that follows it) can never point at the wrong row. Columns size
themselves: `fixed-width` stays at its default of `-1` (GTK's native
content-fit — an explicit width is used "regardless of the size of its
content"), they are **not** resizable (GTK's drag is a bare 1:1 gesture with
no sensitivity setting; user call — this list is a log, not a spreadsheet),
and `Time` + `Solved` have `expand` set — GTK splits the extra width equally
between them, so the columns span the full sidebar — while the digit-only
`#` column keeps its content-fit floor instead of wasting an equal share on
one glyph. All cells are left-aligned (`xalign: 0`): GTK never offers a way
to move a ColumnView header off the left edge, so the cells go under their
headers rather than stranding them (user call, 2026-10-01). Hosted in
`Adw.OverlaySplitView` beside the timer with a header toggle (`collapsed`
stays false — the drawer breakpoint is M6). Sidebar width is in
*logical* px: on this scale-2 session the default 900-logical window puts it
at the `minSidebarWidth` floor (240; `0.25 × 900 < 240`), rising to at most
`maxSidebarWidth` 320 once the window reaches 1280 logical — verified against
libadwaita's source and a live probe, not assumed; see `tools/README.md`
trap 6 before quoting any pixel count from a screenshot. Persistence:
`src/platform/store.ts` writes `{version: 1, solves: [...]}` to
`~/.local/share/cstimer-gtk/sessions/default.json` — debounced 250 ms, atomic
`.tmp` + rename, `flush()` on quit; an unreadable file is quarantined to
`<file>.corrupt-<ts>` behind a toast rather than being overwritten.

Deleting: rows select with a click (Shift/Ctrl-click extends — GTK's own
multi-select behaviour on a `Gtk.MultiSelection`), which reveals the sidebar's
footer bar — a stock `Gtk.ActionBar`, the same bottom bar Warehouse and other
libadwaita apps hang under a list; Adwaita paints its inner box with the
headerbar background + a top shade line, and `revealed=false` collapses it to
nothing, so the bar costs list height only while something is selected. The
bar shows `#8 · 0.60` (one row) or `3 selected`, plus a 🗑 **Delete** button;
the Delete key takes the very same `deleteSelected()` path, so button and key
cannot drift apart. One call carries the whole selection, and one `Adw.Toast`
with **Undo** puts the lot back (`session.restore()` per removal, **in
reverse removal order**, each at the index recorded when it happened).
There is no right-click menu (replaced by this bar — it also took the
popover-blink bug with it) and no Ctrl+Z (removed as unintuitive);
`Session.undo()` went with it, hence 58 tests rather than 59.

Evidence:

- **58 Vitest tests green** (M1's 40 + 14 session + 4 `formatTimestamp`; the
  `undo()` test left with Ctrl+Z).
- **Restart-safe, end to end:** recorded solves → `Ctrl+Q` → file still holds
  them → relaunch → same rows with the same chronological `#`s. Deletions
  during the session left ids 1, 5, 6 in the file — proof ids don't get
  recycled.
- Row click + Delete removed exactly that solve from disk and renumbered the
  rest; the toast's **Undo** put it back at its original position.
- **The footer bar, three states** (screenshots): nothing selected → no bar
  at all (no leftover strip); one row clicked → row highlighted, bar reads
  `#8 · 0.60` + Delete; click Delete → count drops, `Solve deleted` toast
  appears, bar collapses.
- **Multi-select + batch:** click + Shift+Down ×2 highlighted three rows with
  `3 selected` in the bar; Delete removed all three (6 → 3 solves) behind a
  single `3 solves deleted` toast, and its Undo restored all three at their
  original positions. `Ctrl+Z` afterwards changed nothing (action, menu entry
  and `Session.undo()` are gone) and the app log stayed clean.
- The sidebar toggle round-trips and GTK moves the window controls to the
  surviving header by itself.
- `tools/colview_probe.mjs` covers what screenshots can't: factory
  setup/bind, `getPosition()` → id → row text, the `isSelected()` selection
  walk returning exactly the selected ids (`[3, 1]`), and the ActionBar
  revealing (`2 selected`) then collapsing again once a rebuild clears the
  selection.

### M3 — landed 2026-10-01

Sessions. Core: `src/core/sessionLibrary.ts` owns the rules — names unique
case-insensitively, the library is never empty, the last session cannot be
deleted, `create()` switches to the new session, and a session's **id is its
file name, which never changes on rename** (22 tests). Storage:
`sessions/_index.json` + `sessions/<id>.json` under the XDG data dir, ids
validated `/^[a-z0-9][a-z0-9-]{0,63}$/` before they touch a path, a missing or
corrupt index rebuilt from the session files on disk — that rebuild *is* the
M2→M3 migration (`default.json` becomes the `default` session). Solves stay on
the debounced 250 ms atomic write; the index writes immediately (a crash right
after a delete must not leave a ghost entry), `flush()` on exit, and
`deleteSessionFile()` drops a pending write first (16 store tests). UI:
`src/ui/sessionMenu.ts` — one `Gtk.MenuButton` packed **after the sidebar
toggle** (`[toggle][session ▾][WCA][3x3x3][refresh] … title …`), its label the
active session, its `Gio.Menu` a radio-section of sessions plus
`New session… / Rename… / Delete…`. Name dialogs are `Adw.AlertDialog`s with
live duplicate validation (accept stays insensitive until the name is usable);
the delete confirm states the solve count. The sidebar follows the active
session and retitles itself (`name / N solves`); `main.ts` keeps one cached
`Session` per id with its own save subscription, so a change to a background
session still reaches disk — that is what lets an undo toast outlive the
switch that followed it.

Two findings worth carrying forward: `AdwAlertDialog`'s `default-response`
makes the accept button the dialog's default widget, which claims focus on
map — rename's accept is sensitive immediately, so the caret left the entry
(New only worked because an empty name keeps Create insensitive); the dialog
re-claims focus (and selects the initial text) on `map`. And the header grew
its default window to **1080×540**: measured at 900 the header had 660
logical against ~686 of natural demand, so GTK shrank the session label and
the window title (the math is in the `setDefaultSize` comment; staying right
when the window shrinks is M6).

Accelerators (real menu accelerators, GtkMenuButton draws them beside their
items): `<Ctrl+S>` session menu, `<Ctrl+N>` new, `F2` rename,
`<Ctrl>Delete` delete — plain Delete stays the solve list's key.

Evidence:

- **96 Vitest tests green** (M2's 58 + 22 sessionLibrary + 16 store);
  `npm run typecheck` clean.
- **Every flow driven end-to-end in the running app**, keyboard-only: create
  (`meet weekly` → id `meet-weekly`), switch (index `active` + header label +
  sidebar rows all follow), rename via `F2` (typed text *replaced* the old
  name — the focus fix — and the id stayed `default`), delete (confirm →
  file gone → active fell to its neighbour), duplicate name (Return produced
  no accept), and Delete being inert while only one session remains.
- **Cross-session undo:** deleted a solve in `scratch`, switched to
  `Default`, clicked Undo — the solve came back in `scratch.json` while
  `default.json` kept its 9.
- **Restart-safe:** relaunch restored `active: default`, the name and all 9
  solves.
- **Memory (§5 risk row), measured with 10 000 solves via `XDG_DATA_HOME`:**
  baseline (9 solves) 296.5 MB → 312 MB fresh, 327 MB after recording a
  solve, **322.6 MB after 15 wheel-scrolls** — ≈ +26 MB for 10k records, and
  scrolling *releases* rather than accumulates (the ColumnView stays
  virtualized). Trap for the next one: the store lives at
  `$XDG_DATA_HOME/cstimer-gtk/sessions/`, one directory deeper than a naive
  guess — a wrong path silently boots an empty `Default` instead of failing.

### M4 — landed 2026-10-02

Feature-complete core: statistics, penalties, comments, WCA inspection, and
the app-functions menu M3 left spec-empty — plus a queued feature
(per-session scramble type). Five stages, one feature commit.

**Statistics (stages 1–3).** `core/stats.ts` ports csTimer's rules — the *math*,
not the DOM (AGENTS): ao5/ao12/mo3 with trimming (best/worst dropped, DNF
scores ∞ so it lands in the worst slot and can kill a 3-of-5 average), aoX
generalised, best single/average and a PB target, all strictly per-session.
Penalties and comments join the model and the store: `+2` adds 2 000 ms at
read time, `DNF` scores ∞, a comment rides the solve. UI: an ao5/ao12 strip
under the timer, a `Statistics` `Adw.Dialog` (per-session aggregates + target),
both behind the content header's app-functions ⋮ — the section the handoff
flagged as empty — with `<Ctrl+T>` for the dialog.

**Edit dialog (stage 4).** `Adw.Dialog` over the selected solve: penalty
and comment in one form — *superseded 2026-10-10 (user calls)*: the radio
`ok`/`+2`/`DNF` (with mnemonics) became an `Adw.ToggleGroup` in an
`Adw.ActionRow` (`halign: FILL`, the group at natural width, selection by
toggle *name*), the comment `Gtk.TextView` became an `Adw.EntryRow` (title
doubles as placeholder, `maxLength` caps in the widget, `activatesDefault`
restores Enter-saves and deleted the key-controller workaround), and both
rows live in a `Gtk.ListBox` — the penalty row's `halign: FILL`, not an
`hexpand` on the group, is what fills the row. Unchanged through all of
this: the solve's scramble and full timestamp shown read-only; the dialog
re-claims focus on `map` (the M3 `default-response` trick) so typing lands
in the comment box, not on the default button. `<Ctrl+E>` opens it;
`<Ctrl+1/2/3>` grade the selection directly. — *superseded again later
that day (user call: "a normal dialog with a header bar, save button on
the left of the headerbar")*: the container is now a **plain**
`Adw.Dialog` + `Adw.HeaderBar` — title `Edit solve` in the bar (a plain
HeaderBar reads `adw_dialog_get_title` when it roots, so the string lives
in one place), a suggested `Save` **packed at the bar's left**, and the
dialog's own close button free at the right; close and Escape both
discard, exactly as the old close-response `cancel`, and only the button
writes. The heading/body pair became title + first content line (the
identity wraps, never ellipsizes; 12px insets around the boxed list,
matching the picker). Enter saves through `AdwDialog`'s `default-widget`
plus the EntryRow's `activatesDefault` (`default.activate`), and the
map-time focus claim-dance *superseded above* is deleted:
`focusWidget: commentRow` is native here (`map_tick_cb` grabs it) — the
dance existed only because `AdwAlertDialog` fought for its default
response button (observed 2026-10-02), and there is no response button
in a plain dialog. Probe: 26/26 (structure, title plumbing,
Save-left/close-right geometry, native focus, Enter→save, close-without-
save). — *revised 2026-10-11 (user call: "don't focus commentRow by
default")*: the `focusWidget` goes too — the dialog opens on AdwDialog's
natural default focus, which lands on **Save** (first focusable child;
the sheet close buttons are `can-focus: FALSE`), so Enter-from-open saves;
Tab or the Alt+O/2/D mnemonics reach the form. Probe 28/28, including
both "focus NOT in commentRow" assertions. — *the form re-shaped again
the same day, one user call per wave*: the inert `list` class became
`boxed-list` (the card — background, 12px corners, row rules; `list` is
only GtkListBox's CSS node) and `penaltyGroup` got `valign: CENTER`
(GTK's default `fill` would hand it the row's height); the moment became
the list's first row — an `Adw.ActionRow` titled **Date**, stamp as
subtitle, `property`-classed so the value is the emphasized half rather
than the title, later given a copy suffix; the solve number moved into
the title (`Edit solve #id`), leaving the scored time alone above the
card as a big centered number (`timer-display` `size-s` + `numeric`); the
dialog got `contentWidth: 480` (the probe proved the long scramble
subtitle's natural at 870 is clamped to exactly 480 — the AdwDialog
widget's full-host allocation is just the overlay layer); the scramble
line became an ActionRow **before the comment** with a copy suffix
holding *this solve's* scramble (`property`-classed too; both copies
share one `copyToClipboard`/`copySuffix` path from main.ts's probed
clipboard plumbing, copy buttons `valign: CENTER` after a fill
correction); and the penalty moved below the scramble — final order
Date → Scramble → Penalty → Comment, display rows over the controls.
Probe 36/36. — *and* the big number tracks the penalty toggle live: it
re-reads on `notify::active` (fired by `set_active_toggle` for clicks and
programmatic sets alike) through the shared name-based
`penaltyFromGroup()`, showing the *effective* time — `14.34+` for +2 —
and DNF keeping the solved time in view as `DNF(12.34)` (user calls,
2026-10-11). Probe 39/39, against the real `formatSolve`. The size then
stepped 72 → `title-1` — Adwaita's largest built-in heading (~26px,
weight 800), no new styles (a bespoke 48px rule was drafted first and
dropped for the class-only option) (user call, 2026-10-11), `numeric`
retained for the live rewrites. — *and the tall-row problem solved by
the user's own design*: above `EXPAND_SCRAMBLE_ABOVE` (200 — measured
through cstimer_module: 555wca ≤198 chars stays a plain row, 666wca
starts at 269, 777wca at 355, the 234567 relay runs 943–1072, i.e. 17–19
wrapped lines ≈ a 640px row) the Scramble row becomes an
`Adw.ExpanderRow`: collapsed shows one ellipsized line (`subtitleLines: 1`
— adw-expander-row.c forwards to its internal ActionRow), expanding
reveals the whole scramble in a 160px `Gtk.ScrolledWindow`, so the
dialog grows by a bounded 165px on demand — measured 329px collapsed →
494px expanded, inside the 640 floor. The copy suffix rides both shapes
(the expander has `addSuffix`), `property` cannot follow it in (its
selectors need `box.header` directly on the row; the expander nests its
header), and `addRow` clears the `empty` class itself. Probe 47/47.
— *and* Enter no longer saves from the comment row (user call,
2026-10-11: "shouldn't close the whole dialog with enter, only with the
save button"): `activatesDefault` is off the EntryRow — the template
never set activates-default on the internal text either (adw-entry-row.ui),
so the row's property was the sole gate, and the text widget consumes
Return itself — while `defaultWidget` stays, so Return still resolves to
Save from *outside* the entry (focus opens on Save, so Enter there presses
that very button). The probe drives the save path dialog-side
(`default.activate`) and asserts the row's property false.
— *one scroll view instead of two (user call, 2026-10-15, when the floor
dropped to 294 and the editor stopped fitting it)*: the form moved into a
`Gtk.ScrolledWindow` under the fixed header — Save stays reachable at any
height — and the expander's 160px scroller was removed; the relay's full
text lays out unrolled and the form's scroller carries it. Two measured
mechanics: `Gtk.ScrolledWindow` reports a flat 58px unless
`propagateNaturalHeight` is set (against a 502px form — without it the
dialog collapses to a bare header), and the dialog keeps its collapsed
size when the expander opens, so the same scroller takes the growth; at
the floor the dialog clamps to its parent and the form scrolls beneath
the header. The collapsed size is unchanged by the rework (329px in both
shapes). Probe 50/50 — new checks: clamped parent → scrollable form,
header allocated above it, no inner scroller, full text laid out.

**WCA inspection (stage 5).** A sixth timer state, `inspecting`: the first
ready→release starts the 15 s countdown (`formatInspection`, orange, clamped),
the second starts the run graded by the inspection's age at release —
≥ 15 s → `+2`, ≥ 17 s → `DNF` — carried through `onSolved(elapsedMs, penalty)`
into `session.add()`. Esc cancels; releasing early during a mid-countdown hold
resumes the countdown; toggling off mid-countdown cancels, mid-hold drops the
grade. The 8 s and 12 s cues fire exactly once each (per-inspection dedup, so
pause/resume jumps cannot double-beep) — pre-rendered C6 WAV pulses via
`platform/audio.ts`, `pw-play → paplay → gst-launch → aplay`, first present
wins, fire-and-forget (§5's mitigation — no GI audio). `app.inspection`
starts ON and stays memory-only until M5's preferences.

**Per-session scramble type (feature, `8b30797`)** — queued by the user: the
type choice belongs to the active session. `SessionEntry.scrambleType?`
(absent = default `333`), `setScrambleType()` emits `retyped` into the
existing index-save subscription; `applySessionType` runs on every switch and
at startup, moving both controls (the header button and the row's chooser)
through `selectType()` **without**
re-announcing `onChange` (which would write the session's own value back onto
itself), and regenerating the feed only when the type actually differs.
`create()` inherits the active session's type; `loadIndex` shape-checks the
stored string (the index stays hand-editable).

Two findings worth carrying forward:

- **A stateful action with a `'b'` parameter type kills every no-argument
  activation** — GTK refuses them ("Trying to invoke action without
  arguments…") and the toggle dies silently. Plain toggles take `null`;
  only `sessionSwitch` is genuinely parameterized. User-caught; both
  directions verified after the fix.
- **Inspection hold behavior is environment, not code** — a physical
  long-hold in Xephyr bounces through the nested server's stock XKB
  auto-repeat (release/press pairs), faking a countdown-on-hold bug that
  never reproduced under GNOME with Wayland *or* `GDK_BACKEND=x11`
  (user-tested, both backends). Don't add timing heuristics; drive hold
  flows with synthetic input.

Evidence:

- **164 Vitest tests green** — 96 (M3) → 148 by stage 4 → 160 with stage 5 →
  164 with the per-session type; `npm run typecheck` clean.
- **User-verified on the live app:** `+2` and `DNF` from the edit dialog
  round-trip into list and store; Esc cancels inspection; both directions of
  the inspection toggle with a clean log; correct hold behavior under GNOME
  on both GDK backends; and the per-session type ("indeed default shows
  4x4x4") after automated round-trips.
- **Automation on Xephyr `:99`:** countdown/+2/DNF label states captured;
  both cue WAVs on disk; graded solves round-trip the store; the type
  round-trip checked with `jq` against `_index.json` after every switch
  (444 ↔ 555 on `Default`, distinct types per session, both restored on
  every switch).
- **Tooling lessons recorded in [`tools/README.md`](./tools/README.md):**
  `XGetImage` staleness is not XWayland-only — `shot` *and* `rootshot` on
  `:99` replayed minutes-old frames, so state claims were checked against
  the store or a human, not pixels; and the type chooser is driven through
  its dialog rather than a popup — see the recipe in
  [`tools/README.md`](./tools/README.md).

---

### M5 — landed 2026-10-02

What makes the app yours: a preferences dialog that owns every setting, dark
mode, the scramble diagram, and a shortcuts window that documents every
binding. Three feature commits (`9f2f59d`, `02d6ae1`, `cf0963c`), then the
shortcut sync and this record.

**Preferences (stage 1, `9f2f59d`).** `core/preferences.ts` is the pure model
— the `Preferences` shape (hold threshold, inspection, its sound cues, the
scramble image, colour scheme), defaults, per-field validation: a bad value
falls back, it never takes the file down. `prefs.json` lives beside the
sessions, quarantined on damage like the index, saved immediately and
atomically. `Timer.setHoldThreshold()` lands the dialog's value on the very
next hold (clamped, NaN-safe). The dialog is an `Adw.PreferencesDialog` built
fresh on open — Timer page first (`SpinRow`, seconds in, ms out, plus the
inspection and sound-cue switches) — reachable from the app-functions ⋮ via
the `app.preferences` action on `<Ctrl+comma>`. One `applyPreferences()` path
merges + persists + pushes, so the header check item, the timer and the file
cannot disagree; inspection is no longer memory-only.

**Dark mode (stage 2, `02d6ae1`).** The `colorScheme` preference (`system` /
`light` / `dark`) drives `Adw.StyleManager`, applied before the window is
presented — first paint is already right — and on every change through the
same `applyPreferences` path: `system` → `DEFAULT` (the default manager,
follows the desktop, light fallback), `light`/`dark` → `FORCE_*`. The dialog
gains its Appearance page: an `Adw.ComboRow` whose label factory is fed with
`setExpression(makeStringExpression())` — the positional/setter path, since
the expression *property* still aborts node-gtk (decision 10). *The call was
removed 2026-10-06: a plain `Gtk.StringList` labels itself on GTK 4.22.5 /
libadwaita 1.9.4, and the probe now asserts it — decision 10.*

**Scramble diagram (stage 3, `cf0963c`).** The image rides the same worker
round trip as the text (`scrambleWithImage`), so both land in one frame; an
image `Map` in `main.ts` (keyed `type\0scramble`, capped at 16) feeds the
panel through a `getImage` getter that also covers the ghost. Images are
always fetched (~1 ms in the worker) — `prefs.scrambleImage` only gates
*display*, so the switch is instant and reflows nothing. The picture is
handed to `main.ts` as an **overlay child of the whole view**: GTK4 does not
count overlay children in the size request, so the diagram floats in the
bottom-right corner (user call) without ever moving the text or the timer, at
any window size. Transparent background (user call) — the SVGs arrive
transparent from `cstimer_module`; the white card of the first draft read as
a stray box. `Rsvg-2.0` joins the generated typelibs, and the dialog gains
its Scramble page (the image switch) in this stage.

**Shortcut sync (stage 4).** `src/ui/shortcuts.ts` now lists every binding,
cross-checked against each `setAccelsForAction` and the key controller — the
two that were missing are `<Ctrl+comma>` (preferences) and `Escape` (cancel
the inspection countdown); the header comment was rewritten to match.

**Parked out of M5 (user calls):** the golden-ratio timer position nudge — a
later task; and the diagram's thin outlines read low-contrast on the dark
theme (accepted for now, noted in a code comment).

Findings worth carrying forward:

- **Overlay children take no size-request space** (measured, stage 3) — the
  right home for anything that must float without shifting layout; expect to
  lean on it again in M6, where the timer and scramble finally use the space
  they get.
- **The probes need the whole runtime**: `prefs_probe` run under bare
  `--import tsx` dies with `ERR_UNSUPPORTED_ESM_URL_SCHEME` on the `gi:`
  protocol — always start it with `--import tsx --import node-gtk/register`.

Evidence:

- **180 Vitest tests green** — 164 (M4) → 180 with the preferences model,
  `prefs.json` round-trips and the hold-threshold clamping; `npm run
  typecheck` clean.
- **`prefs_probe` ALL PASS** — 18 checks against the real dialog (every
  row's read/write round-trip through `prefs.json`, including the ComboRow).
- **`scramble_probe` 206/206** — every type generates; 177 with images, 29
  without (`getImage` returns false, never throws).
- **User-verified on the live app:** it runs dark; `<Ctrl+comma>` opens the
  dialog and it is closed again; the diagram sits in the bottom-right corner
  with a transparent background.
- **Shortcuts window captured fresh** (stable double-shot, no stale-frame
  doubt) with both new chips rendering — `Escape` and `Ctrl+,`, no empty-chip
  parse failures.

### M6 — landed 2026-10-02

Adaptive layout. Every threshold and both decisions live in
`src/core/layout.ts` as pure functions (`layoutFor`, `BREAKPOINTS` — and
`timerMargins` too, until the nudge was dropped on 2026-10-05, see below);
`src/main.ts` only measures and applies. Five **disjoint**
width bands (S ≤480, C 481–540, B 541–800, M 1200–1599, L ≥1600) as
`Adw.BreakpointCondition`s written from those same constants, plus
`Gdk.Surface::layout` for what bands cannot see (height, in-between sizes)
and `Gdk.FrameClock::after-paint`, which now drives `updateDiagram` — the
picture's size log and bottom-bar lift, since it was the timer nudge.

*Size source, revised 2026-10-11 (Adaptive Preview):* `applyLayout` reads
`window.content`'s allocation — the child of the same `AdwBreakpointBin`
the band conditions are evaluated against (adw-application-window.c) — so
one rectangle serves tiers and bands whether the window shows the app
directly or the preview's emulated screen, with no feature test anywhere
in main.ts. The surface read (and its CSD-shadow subtraction) is gone;
`Gdk.Surface::layout` remains as the early, one-frame-stale trigger that
can only re-apply the in-force tier, and after-paint, with fresh
allocations, lands every new one — band crossings, height-only resizes,
preview toggles and emulated-device switches alike. Probe: preview content
360×670 inside a 1000×700 window; `max-width: 360px` applies while the
window is 1000 wide.

- **Drawer sidebar ≤800** — `Adw.OverlaySplitView.collapsed`, auto-hide on
  collapse / auto-show on uncollapse, wired exactly as libadwaita's own
  "Overlay Sidebar" demo: one bidirectional binding between `show-sidebar`
  and the header toggle, so the property *is* the state. `<Ctrl+B>`
  (`app.sidebar`) and `Escape` (drawer only) are the other two callers of
  `setShowSidebar()`; both are in the shortcuts window.
- **Selectors leave the header** for their own row at ≤540 — that width band
  is the whole rule (user call, 2026-10-04; edge moved 600 → **540** on
  2026-10-11, user call — the type picker's collapse breakpoint shares
  `selectorRowMax`, and 540 puts a phone in landscape, its dialog wider
  than 540, on the picker's two-column side). It was previously two conditions:
  the band, **or when the measured labels stopped fitting** — `layoutFor` took
  the header's natural width and handed the row over when it exceeded the room
  by more than `headerSlack` (200). Measured then: the header asks **724px**
  with a 3x3x3 session and **1186px** with the catalogue's worst pair (FTO
  category + Diamond type), the second pushing the window controls off the edge
  of a 900px window, so the band alone could not be the rule. That second
  condition existed only because the two Gtk.DropDowns could *not* shrink; the
  header's selector became one button whose label ellipsizes (icon button +
  ellipsizing `Adw.WindowTitle` since 2026-10-08), so
  `headerSlack` and the demand measurement went with it.
- **Growing sidebar / scaling**: timer `s`/`m`/`l` (also `s` below 480 wide
  *or* 480 tall); scramble slot 60/76/88 chars, 100/160/220 px tall; diagram
  cap 440×150 → 500×170 → 560×190 (the last two only when tall). The sidebar
  width used to scale with the tiers too (`maxSidebarWidth` 320 → 380 at
  ≥1200 → 440 at ≥1600) — *superseded 2026-10-09 (user call)*: 320 is the
  cap at every width, the growth steps are gone, and `sidebarMax` is now a
  constant the tiers merely carry.
- **The nudge** (user rule, 2026-10-02, **halved to a quarter the same
  day**): the timer block sits a quarter of a diagram's height *up* and a
  quarter of its width *left* of where it would otherwise centre — and
  nowhere else moves it (the golden-section rule was deleted). Both margins
  are clamped by `NUDGE_SLACK` (16) against the **window**, never against
  the content's own allocation.
  **Phone form factor (user call, 2026-10-03)**: at ≤600 (tiers C and S, the
  same `selectorRowMax` band that moves the selectors out) the sideways nudge
  is **dropped** — the timer stays horizontally centred — and the lift
  **doubles to half a diagram-height** (`phoneFormFor()` → `phoneForm`, read
  from the surface width like every other layout number). Clamping is
  unchanged, so the invariant still outranks the rule.
  **Dropped entirely (user call, 2026-10-05)**: the timer stays centred at
  all times — "the current method is not clean and elegant". `timerMargins`,
  `TimerPlacement`, `NUDGE_SLACK` and `phoneFormFor` are deleted from
  `layout.ts` (19 nudge tests with them, 217 → 198); `updateNudge` in
  `main.ts` became `updateDiagram`, which keeps only the diagram's own
  duties (size log + bottom-bar lift). The clamping lessons above still
  stand for anything that sizes from a measurement: never clamp against a
  box GTK has already given its minimum, and ground the room in the window,
  not the content's allocation.

Decisions worth carrying forward:

- **No intent memory for the sidebar.** An earlier `sidebarWanted` +
  `notify::show-sidebar` override fought libadwaita's auto-show and ping-
  ponged (43 flips, two handler re-entries each, in one session). A closed
  list reappearing when the window grows back is the accepted price of the
  binding — and `Escape` still closes a drawer.
- **Ground truth is the surface, not a widget allocation.** Mid-resize the
  widgets answer with the *old* size (measured: surface 460, window 890,
  split 762 — three true numbers from three different moments), and a
  decision from any of them is a decision about a window that no longer
  exists. `groundWindowSize()` reads the surface minus the CSD shadow
  (measured 10×10) and feeds both `layoutFor` and the margin clamp.
  *(Revised 2026-10-11 for the Adaptive Preview, user call: "something
  general that naturally works with adaptive preview" — the ground is now
  `window.content`'s allocation, the child of the very breakpoint bin the
  band conditions are evaluated against, so tiers and bands share one
  rectangle in every embedding with **no feature test** — a grep for
  `adaptivePreview` in main.ts comes back empty. The staleness argument
  above turns into a *when* rule: surface `layout` can only re-apply the
  in-force tier, after-paint — fresh allocations — lands the new one; the
  surface read and its 10×10 CSD-shadow subtraction are deleted. Probe
  evidence (`tools/preview_probe.mjs`): preview content 360×670 inside a
  1000×700 window, and
  `max-width: 360px` applies while the window is 1000 wide.)*
- **Never clamp against a box that GTK has already given its minimum.** The
  content's allocation contains the margin being computed, so that clamp is
  a tautology that settles *above* the window and clips (439px of content in
  a 370px window, `libadwaita` then logging "snapshot … without a current
  allocation"). It is also what made the app look frozen: four shrinking
  passes in a row trip GDK's `layout continuously requested, giving up after
  4 tries`, and the frame that never comes looks like a hung UI.
- **A just-revealed bottom bar may report 0.** Since 2026-10-04 the selector
  lives in `Adw.ToolbarView`'s bottom-bar slot. On the frame it is revealed,
  `getBottomBarHeight()` can still be 0; `updateDiagram` therefore floors that
  animated height at the selector bar's natural height. During a hide, it uses
  the actual animated height down to 0. This is the ToolbarView equivalent of
  the old “just-reparented ListBox row reports 0” workaround above.

Evidence:

- **203 Vitest tests green** (180 at M5 → 199 for the layout/nudge core →
  203 with the measured-header rule), `npm run typecheck` clean.
- **`breakpoint_probe` answers all four questions**: apply/unapply fire with
  current sizes, all five disjoint bands fire on every crossing up and down,
  `Gdk.Surface::layout` reports each resize, and `set_default_size` does
  *not* resize a presented window (so verification drives sizes with
  `xdotool windowsize`, in surface px: widget = surface − 10).
- **Full band walk, keyboard only, 0 warnings**: 900 → 700 → 550 → 460 →
  `<Ctrl+B>` → `<Ctrl+B>` → `Escape` → 400×360 (the floor *then*; it is
  360×360 since the HIG change in §7) → 1700 → 900,
  with an aliveness check after every step. The log shows exactly one
  `[sidebar]` line per state change (no ping-pong) and
  `[layout] 390x350 (win 350)` at that floor — content under the window, no
  `AdwToastOverlay exceeds` line anywhere. Re-verified at the new floor:
  `350x350` (360×360) and `350x630` (360×640), still zero warnings — §7.
- **Thresholds re-checked against measurement**: at 801 side-by-side the
  header absorbs 163px (natural 724 in 560) with every control drawn, so
  800 stands; the selectors' own row fits from 531 (its natural with the
  longest labels is 521) so 600 stands; with those labels at 900 the
  controls *were* clipped (absorption 536) and at 950 fine (486) — which is
  what `headerSlack: 200` decided, switching to the row early rather
  than gambling on how much GTK will absorb. **The clipping above is the
  reason `headerSlack` existed, and it was removed 2026-10-04** along with
  the demand measurement, once the selector could ellipsize instead; the
  724/561/521 numbers remain the record of why 800 and 600 were chosen.
  — *the edge is 540 since 2026-10-11 (user call)*: those 521/531 belong
  to the two-dropdown row, and the selector is an icon button with the
  type text in the title since M6, so the row's natural is far under the
  new edge — and the constant also drives the type picker's collapse
  breakpoint, where 540 puts a phone in landscape on its two-column side.
- **The nudge measures right** *(superseded — the nudge was dropped
  2026-10-05, so the timer is centred now; kept for what it proved about
  measuring against the window)*: at 900 the timer block's centre lands 1.5px
  from `content centre − diagram width / 4` (519 measured vs 520.5
  predicted, screenshot pixel scan), and the halving from /2 was visible in
  the same geometry — the old rule put it at 469 (vs 471 predicted), so the
  digits moved 50px right and 38px down, which is the 1/2 → 1/4 change on
  both axes. It moves with the diagram at every tier.

---

## 7. Session handoff

- Project rules live in [AGENTS.md](./AGENTS.md) (auto-loaded every session).
- This file is the plan of record; update §6 checkboxes/notes as milestones
  land so a cold session can pick up correctly.
- **M7–M16 scheduled — queue reordered 2026-10-16** — **M13 release
  readiness → M14 touch input → M15 phone-runtime verdict**, then M7 size
  preferences → M8 scramble type options → M9 i18n → M10 csTimer
  import/export → M11 records & statistics → M12 charts → M16 AUR package.
  Numbers are stable identifiers, not queue positions (§6) — only the order
  moved, because milestone numbers are about to appear in tag messages and
  changelog entries. Nothing was dropped: M7–M12 and M16 remain scheduled.
  Three decisions settle most of
  the "how": sizes **scale** `layoutFor()` instead of replacing its tiers
  (decision 14), i18n comes before every *string-heavy* feature so M10's and
  M11's are written translated rather than swept later (decision 11) — M8
  sits ahead of it, and having its handful of labels swept is the accepted
  cost of pulling it forward — and csTimer compatibility is one pure codec
  plus the two
  `properties`/`sessionN` findings in §5 (decision 12). Open before M10: a
  sanitized real csTimer export file would be the golden fixture — without
  one, the codec is only tested against my reading of csTimer's source.
  Open before M13: only the **icon** now — its *direction* is decided and
  recorded in the M13 block (cube alone in a PLL Ga state, no timer, 25°
  elevation, computed by a generator rather than drawn), but the artwork
  itself, its **symbolic variant**, the baseline alignment and the icon name
  are still to do. The **public name is settled**: `Puzzle Timer` was adopted
  2026-10-07 with the repo `xlucn/puzzle-timer`, so what is left of that
  decision is the rename checklist in the M13 block — `package.json`,
  `APP_NAME`, the README and About links, and the app id, which must land
  before the first tag. M13's first half (versioning, CHANGELOG, About, README,
  the AI disclosure) needs no icon and no name call, so it may be pulled
  forward.
  **M16 (AUR) has two blockers**, both written into its §6 block: M13 (name,
  icon, `.desktop`, a tag) and the repo's **privacy** — `makepkg` fetches over
  plain HTTP, so the sources must be public at tag time. The draft PKGBUILD
  and the size measurements live there too, along with the first two things to
  test: Arch's `typescript` 6.0.3 against our declared `^5.5.0`, and whether
  the built `dist/` runs at all.
  Open before M7, M8 and M9: nothing — M8's one open question (whether the
  bundled scrambler honours the 4th `neutLevel` argument) is a probe inside
  its own block. Probes that gate M10, M12 and M14
  (`Gtk.FileDialog` async callbacks, `Gtk.DrawingArea.setDrawFunc`, gesture
  competition on the `ColumnView`, and swipe vs. kinetic scroll) are called
  out at the top of their milestone blocks. **Ordering caveat:** M14 (touch)
  follows M13 by user call, not by dependency — so the first public tag
  (`0.1.0`, cut at M13) ships **without** touch input, and the keyboard stays
  the only way to drive it. Accepted; if that stops being accepted, M14 moves
  ahead of M13 and `0.1.0` waits for it.
- **M6 landed 2026-10-02** — adaptive layout is in and verified (the dated
  block in §6 has the decisions and the measurements). What a cold session
  needs to know: `src/core/layout.ts` owns every threshold, the sidebar's
  `show-sidebar` is a plain libadwaita binding (do not add intent memory
  back), and sizes are read from the *surface* because widgets lag a pass
  behind during a resize. `npm test` = **219 tests**; the manual band walk
  (keyboard, Xephyr `:99`) is in `tools/README.md` → Recipes.
  **Next milestone: M13 (release readiness)** — see the bullet above; M14
  (touch input) and M15 (the phone-runtime verdict) follow it. M7–M12 and
  M16 are scheduled but deferred, not dropped. The still-unscheduled backlog
  is stackmat and the rest of packaging (Flatpak, deb), which only M15 can
  reopen (§1).
  Still open from earlier user calls: the diagram's thin outlines read
  low-contrast on the dark theme (accepted for now, noted in a code
  comment), and one startup-only `AdwToastOverlay exceeds` warning with the
  catalogue's longest labels (its stated cause was the first frame measuring
  the selectors in the header before any tier had run — that measurement went
  with `headerSlack` on 2026-10-04, so re-check whether it still reproduces).
  The stats
  rule stands: **per-session, always** (M3's scope), `src/core/` owns the
  math, and csTimer's GPL source may be ported for the *math*, not the DOM
  (AGENTS.md).
- **Layout: "F" (2026-10-01)** — the solve list is the **left** sidebar
  (`sidebarPosition: START`, width clamped 240–320 logical), and the sidebar
  owns the app chrome: its header reads `csTimer GTK … [app menu ⋮]`, the
  session switch is a full-width row under it (its label *is* the current
  session name), then the list. The content header reads
  `[toggle][WCA][3x3x3][refresh] … [app-functions ⋮][window controls]` with
  no title — the app name lives in the sidebar header; the window title still
  goes to the taskbar. This layout came out of the A–E mockup comparison
  (`mockups/`, GTK and HTML variants — deleted once F landed in the real
  app); the default window is back to **900×540**, since the header lost the
  title and session pill (math in the `setDefaultSize` comment). All three
  items deferred from here are **M6's and now landed**: the long
  category/type selections that outgrow the header (they move to their own
  row instead, §6 M6), the drawer breakpoint (≤800), and the sidebar width
  caps (320 → 380 → 440; *capped at 320 everywhere since 2026-10-09*, see
  §6 M6 scaling). About / Keyboard Shortcuts / Quit sit in the
  sidebar app menu — unreachable while the sidebar is closed, which is why
  `<Ctrl+Q>` stays the quit path that always works (`<Ctrl+B>` reopens the
  list, and `Escape` closes the drawer).
- **Solve list columns (user call, 2026-10-02)** — the sidebar reads
  `# | Time | ao5 | ao12`; the `Solved` timestamp column is gone (the moment
  is still spelled out year-to-second in the Edit dialog, which is where a
  solve is read individually). The averages are **as of their own solve** —
  the window *ending* there, not today's number repeated on every row — so
  the column reads as the history of a run. `rebuild()` computes them in one
  pass via `windowAtEach()` (src/core/stats.ts, 207 tests) and a row shows an
  em dash until its window fills, the same rule as the strip under the timer.
  Cross-check on the shipped session: the newest row reads 6.79 / 5.98 at the
  same moment the strip does, and row 9's ao5 (2.18) is its own five with the
  DNF trimmed away.
- **Scramble is display-only, copy is a button (user call, 2026-10-02)** —
  the text is no longer selectable (`selectable: false`), so it left the
  focus chain with it; copy lives on the header beside refresh and on
  `<Ctrl+C>`, with a toast as the only proof the key did anything. GDK4 has
  no `clipboard.set_text`, so the clipboard takes a
  `Gdk.ContentProvider.newForBytes('text/plain;charset=utf-8', …)` — verified
  by pasting back through the edit dialog's comment box (no xclip on this
  box). Two follow-ups from measuring it: the header's demand went 724 →
  **808px** with the extra button, so the measured-header rule now switches
  the selectors to their own row below **848** wide instead of 764 (row at
  835, header at 850 — measured), and `Ctrl+C` inside the comment box still
  copies the *selection*: GTK gives a focused editable its own key bindings
  before the app's accelerators.
- **Keyboard drives the session UI** (useful for testing, shipped as real
  accelerators): `<Ctrl+S>` opens the session menu, `<Ctrl+N>` new, `F2`
  rename, `<Ctrl>Delete` delete — after opening the menu, `Down` + `Return`
  selects a session (the menu focuses its *first* item, not the checked one).
  The keyboard reference is a stock **`Adw.ShortcutsDialog`**
  (`src/ui/shortcuts.ts`, built fresh on `app.shortcuts`, no accelerator of
  its own) — it replaced `Gtk.ShortcutsWindow` (deprecated since GTK 4.18)
  on 2026-10-02: same sections/items shape, but it renders as a libadwaita
  dialog *inside the app's window* rather than as a toplevel, it brings its
  own search field, and it constructs and renders fine under node-gtk — so
  the planned fallback of putting the keys in the About dialog body was
  never needed and is now moot. Watch the key names: gdk_keyval names are
  case-sensitive (`space`, not `Space`), or the chip renders empty (checked
  with `Gtk.acceleratorParse`: all 18 entries parse).
- **Header: type as title/subtitle, icon-only select (user call,
  2026-10-08)** — the "category - type" text left the button and became the
  header's **`Adw.WindowTitle`** (title = category, subtitle = type; split
  tested against `scrambleTypeLabel` by reassembly equivalence in core), so
  the centre slot always names the type in both layouts. The control is now
  an **icon-only button** (`view-list-symbolic`) packed after copy —
  header order: sidebar, refresh, copy, select. The WindowTitle is assigned
  as `titleWidget` once and **never reparented**, which makes the
  stale-`HeaderBar:title-widget` trap (remove() clears the centre bin but not
  the property, adw-header-bar.c) unreachable by construction — that trap is
  why the morning's *button-as-title-widget* experiment (superseded the same
  day) needed `setTitleWidget(null)` instead of `remove()`. Its template
  labels ellipsize (`adw-window-title.ui`), so a long type cannot raise the
  header's minimum (`headerSlack` stays dead), and an empty subtitle hides
  itself, so a hand-edited unknown id shows verbatim on one line. Centre
  alignment: `GtkCenterLayout` positions the centre child at
  `size/2 - width/2` — **absolute centre**, pushed aside only on collision —
  measured +1px drift vs the header's true centre at 900/620/601 (integer
  rounding); the available-gap centre (start box 168 vs end 154) would be
  +7px and is **not** what any `centeringPolicy` gives: `STRICT` only
  size-groups the side boxes so the gap *becomes* symmetric (measured
  identical to `LOOSE` here). Absolute centre is also the common choice —
  it is what every GNOME app's HeaderBar does by default.
- **Image toggle: right side of the bar (user call, 2026-10-08)** — a flat
  `Gtk.ToggleButton` (`image-x-generic-symbolic`, the same icon the
  Preferences group uses) that shows or hides the scramble diagram. It
  drives the **existing `scrambleImage` preference** through
  `applyPreferences` — the same single-writer path the Preferences
  `SwitchRow` uses, so prefs.json, the dialog and the toggle can never
  disagree — and `applyPreferences` mirrors the value back onto the
  button's `active`, with an equality guard in the handler so the mirror
  cannot loop (probe: one write per click, external change propagates,
  same-value assign is a no-op). Placement: `packEnd` in the header —
  `AdwHeaderBar.pack_end` *prepends*, so the last-packed toggle lands
  **left of the app-functions menu**, keeping ⋮ the rightmost app control —
  and right-aligned in the bottom bar via `halign: END` + sole `hexpand`.
  It joins the `placeSelectors` move (four widgets, not three), and it is a
  focus stop: the wide chain gained one stop, `Shift+Tab`×7 (AGENTS
  Focus anchors). Floor: header min 282, row min 156 → 198, both ≤ 360.
- **Narrow: all four bar controls share the bottom bar (user call,
  2026-10-08)** — below 540 refresh, copy, select **and the image toggle**
  move together into `Adw.ToolbarView`'s **bottom toolbar**: the three
  scramble buttons left-packed at natural width, the image toggle
  right-aligned at the far edge (halign END; it is the bar's only
  `hexpand`, so it takes the slack while staying natural — measured, no
  spacer needed; the 6px gap between buttons comes from Adwaita's
  `.toolbar`, not a `spacing` property) —
  replacing the morning's equal-thirds `hexpand` and the original single
  full-width labeled button. The header keeps only sidebar toggle, title and
  app menu. `ToolbarView`
  owns the page structure: header in its top-bar slot, scramble/timer in its
  content slot, and a `.toolbar` `Gtk.Box` in its bottom-bar slot. The same
  four widgets are reparented between the bars; in the header none of them
  expands, so the window controls are unaffected.
  `ToolbarView` supplies native flat-bar styling; its animated bottom-bar
  height is what `updateDiagram` adds to the diagram's bottom clearance (the
  timer-region subtraction went with the nudge, dropped 2026-10-05). Each
  button owns its own activation, so the old
  `Gtk.ListBox` row-activated/key-controller workaround is gone. Both layouts
  open the same `Adw.Dialog`, whose body is an **`Adw.NavigationSplitView`**
  used natively (user call, 2026-10-05). Each `Adw.NavigationPage` carries its
  own `Adw.ToolbarView` + `Adw.HeaderBar`, so the split view itself provides
  the page titles and — collapsed — the back button (a real `AdwBackButton`,
  confirmed in the widget tree). Collapse is an **`Adw.Breakpoint`**
  (`max-width: 540px`, `BREAKPOINTS.selectorRowMax`) applied to `collapsed` via the breakpoint's
  apply/unapply signals (node-gtk can't box the GValue `addSetter` needs). The
  dialog is given only a default `contentWidth`/`contentHeight` (720×480) and
  clamps itself to the parent window — there is no parent-surface listener and
  no manual `contentWidth` chasing, so the switch follows the dialog's
  allocated width. (A breakpoint-bearing dialog also needs an explicit
  `width-request`/`height-request` minimum — AdwDialog docs — or it logs
  "does not have a minimum size" warnings.) The category list is built once;
  the type list holds only the browsed category's rows, refilled by one
  `renderTypes()` when the browse index changes. **Perf fix (user call,
  "the popup is slow", 2026-10-06):** it used to filter all 206 rows in place
  with `Gtk.ListBox.setFilterFunc` — and *that* was the slowness: every
  invalidation crosses the node-gtk boundary once per row (206 rows ≈79ms
  even with a `() => true` predicate, ≈0.4ms/row; `open()` blocked 125–141ms,
  and a category click paid it twice, notify-then-activated). Rebuilding the
  visible ~19 rows costs ≈3ms: `open()` 125–141ms → 14–22ms, click → visible
  ≈140ms → ≈24ms (measured with `/tmp` timing probes; first-ever open keeps a
  one-time ~190ms layout warm-up). The "never rebuilt" rule it replaced was
  guarding against render paths keyed on *layout* state — there is still
  exactly one path, keyed on `browse`. Selecting a category updates
  the type filter and, collapsed, pushes to the content page
  (`showContent = true`); the split view's back button pops it. The active
  type carries a ✓ suffix (`object-select-symbolic`). There is no search
  entry (dropped 2026-10-05 — it was the messy part), and type rows show just
  the type name: the category is the selected row on the left and the content
  page's title, so prefixing it per-row was redundant. The sidebar's 44
  categories sit in **four `Adw.SidebarSection`s** — csTimer's higher classes,
  the disabled `===WCA===`/`===OTHER===`/`===SPECIAL===`/`===JOKES===` header
  rows in `scrdata` (kernel.js renders `/===/` unselectable; zh-cn reads
  WCA/其他/训练/213). Boundaries live in `core/scrambleTypes.ts`
  (`SCRAMBLE_SECTIONS`, unit-tested as a true partition of
  `SCRAMBLE_GROUPS`); section titles and the separators between them are the
  widget's own in both sidebar and page modes, and item indices stay flat
  across sections (probe-verified), so `browse = group index` still holds.
  Navigation, selection and activation are the widgets' own. (Lesson — see
  AGENTS.md "Let adaptive widgets do their job": an earlier ~600-line version
  hand-rolled the collapse, back button, titles and per-state list rebuilds
  that this widget provides; the native rewrite is ~300 lines.)
  `AdwActionRow` titles are parsed as *markup*, so `useMarkup: false` (else
  `3x3x3 Roux - LSE <M, U>` logs a parse warning). Layout consequence: the
  bottom bar's animated slot height is added to the diagram clearance in
  `updateDiagram` (and floors it — see the M6 note above).
  Also: the first frame now takes its tier from the *asked-for* size
  before `present()`, because with `lsll` selected the old order asked **928px
  in an 890px window** on frame one (0 warnings since).
- **Window floor: 360 wide (user call, 2026-10-03)** — the GNOME HIG's
  minimum for the phone form factor (developer.gnome.org/hig/guidelines/
  adaptive.html); 400 was this project's own number, and the comment that
  justified it (the two dropdowns wanting ~282px) died with them. Height
  stays 360, so the floor is square, and the width now equals libadwaita's
  own `AdwWindow` default (360×200) — `minHeight` still performs the
  override the breakpoint docs ask for. The original floor measurements were
  with the `Adw.ButtonRow`; since 2026-10-04 it is the shared `Gtk.Button` in
  `ToolbarView`'s bottom bar. Reverified: **360×360 → `350x350 (win 350)`,
  drawer, selectors in their own row, timer s, WM minimum 360×360, no app
  warnings**; phone shape **360×640 → `350x630`**, toolbar button
  at the bottom (then one full-width labeled button; since 2026-10-08 three
  left-packed icons — that geometry needs re-measuring too), timer and
  picture clear of the bar. At square 360×360 the
  fixed 150px diagram still overlaps the timer — even the nudge clamp could
  not create enough vertical room there; this is the short-window overlay
  limit, not a ToolbarView bar overlap. **That measurement was taken with the
  nudge in place** — the nudge lifted the timer toward the bottom-right
  picture, and was dropped 2026-10-05, so this no longer describes the
  current geometry. Re-measure before acting on it: M14 carries the item.
  The `390x350` above is the old floor's
  number, kept for what it proved.
- **Height floor 360 → 294 (user call, 2026-10-15)** — the HIG sentence is
  "scale down to 360×294px" (Small Size Handling); the earlier reading took
  360 for both axes and squared the floor. 294 is the height — and exactly
  the height a phone in landscape gives an app. Width stays 360. Headless
  `tools/floor_probe.mjs`, both backends: `heightRequest` floors the *widget* at exactly
  the request — on initial allocation **and** against a forced `xdotool`
  resize — so the expected floor line is **`[layout] 360x294 (win 294)`**,
  reached at xdotool `370×304` under the walk's +10 CSD rule (the probe
  display's own CSD reads +50, hence the probe asserts widget numbers, not
  the shadow). The old `350x350` / WM-minimum-360 expectations cannot arise
  while `widthRequest = 360` is in force (widget ≥ 360 by construction) —
  they predate the requests taking effect in a run. The 350 *fit*
  measurement above is still the only measured vertical fit, and the one
  thing unmeasured is the real content's own minimum: a request can only
  *add* to a floor, so the walk at `370×304` is what confirms the window
  actually reaches 294.
- **Floor vs content: the `AdwToastOverlay exceeds …` family (user report,
  2026-10-15)** — confirmed exactly as the note above feared: at the floor
  the content's own minimum was **300** (bars 91 + panel 77 + timer 145
  with real stats values), so every measure below it warned
  (`requested 300, 294 available`), and width had the same family at the
  360 floor (the header still holding its controls: 650 → 410 until
  `placeSelectors` caught up). Three parts, all needed:
  (1) the stack's minimum came down to 290 — panel top margin 14→8, timer
  box spacing 4→2, measured headless on the real widgets
  (`tools/content_min_probe.mjs`: height is text-independent —
  empty/3x3/relay all equal, and
  width-independent at 505/480/360; 277 after, real = that + the stats
  values the stub never rendered);
  (2) `groundWindowSize` stops believing an over-allocated child —
  `min(content, window widget)`: when the minimum exceeds the window GTK
  still gives the child its request (the report's `505x300 (win 294)`,
  the run's `650x294`), so the ground described a window that did not
  exist and held the wrong tier open — the header kept its controls past
  `selectorRowMax` while the floor had already been reached;
  (3) together the tier now lands on the first pass.
  Verified on the live session (scale-2 XWayland; xdotool args in device
  px): four resizes including two 900×540 → floor crossings — **0
  `AdwToastOverlay` warnings**, log `505x294 (win 294)` and `360x294 (win
  294)`, `selectors in their own row` from the first floor line.
- **Scramble panel stability (2026-10-01)** — the timer must not move when
  the scramble updates, in either direction. The spinner/status row is a
  `Gtk.Overlay` child of the text slot, never stacked under it (stacked cost
  +22 px against a one-line scramble — measured 86 vs 64; GTK4 does not
  measure overlay children). And while the feed is busy the last scramble
  stays on screen as a dimmed ghost (`.scramble-text.pending`, opacity 0.4),
  so a tall text's slot never collapses: the panel height is the text's, in
  every state. First load has no ghost (bare slot); a warm failure still
  reports *under* visible text — the one status that shares the panel with a
  scramble. User-verified live on 4x4.
- To resume: read this file + the current milestone row, check what exists in
  `src/`, continue from there.
- Before trusting a screenshot of the running app, read
  [`tools/README.md`](./tools/README.md): X captures are often stale — on
  XWayland *and* on the nested server (M4 saw `shot` and `rootshot` on `:99`
  replay minutes-old frames) — and the duplicate-instance rule means a second
  `npm start` silently attaches to the first.
