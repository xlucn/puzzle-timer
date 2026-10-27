# Puzzle Timer — project instructions

Native Linux cube timer (csTimer-like), built with GTK4 + libadwaita.
Full plan, technical decisions, and research evidence: **[PLAN.md](./PLAN.md)**.
Other docs: **[README.md](./README.md)** (user-facing), **[BUILD.md](./BUILD.md)**
(build/run/test detail), **[CONTRIBUTING.md](./CONTRIBUTING.md)** (contributor
entry point — the rules here apply to humans too), **[DESIGN.md](./DESIGN.md)**
(current-state architecture, distilled from PLAN.md), **[RUST-PORT.md](./RUST-PORT.md)**.

## Stack (decided — do not re-litigate without being asked)

- **UI:** `node-gtk` (GObject introspection bindings) + GTK4 + libadwaita
- **Language:** TypeScript, run via `tsx` (no separate build step in dev)
- **Scrambles:** `cstimer_module` (official csTimer package) running in a `worker_threads` worker
- **Tests:** Vitest, on pure core modules only
- **License:** GPL-3.0-or-later (LICENSE file) — mandatory: `cstimer_module` and csTimer source are GPL-3.0

## Architecture invariants (highest-priority rules)

1. **`src/core/` is pure TypeScript.** It must import **neither** `gi:*`
   **nor** Node-only APIs (`node:fs`, `node:crypto`, `worker_threads`).
   Rationale: keeps the timer/stats/session logic unit-testable without a
   display server, and keeps a future runtime swap (e.g. to GJS) down to
   `ui/` + `platform/` + `scramble/`.
2. **Node-specific code lives in `src/platform/`** (`store.ts` for persistence,
   `random.ts` for CSPRNG seeding) and `src/scramble/` (worker host).
3. **Only `src/ui/` touches `gi:*`** (Gtk, Adw, GLib, Gio, Gdk, Gst).
4. **Scramble generation never runs on the main thread.** A 4x4 WCA scramble
   takes ~1.2 s (measured) and would freeze the UI.
5. **Custom widget subclassing: try it, probe it, fall back if it fails.**
   If subclassing is the easy way, attempt it; verify with a *runtime* probe
   before trusting it (typecheck proves nothing about GObject behavior); if
   it segfaults or signal payloads come back as bare wrappers, drop it for
   maps/closures and record the failure here. Plain JS wrapper extension
   (`class MyRow extends Adw.ActionRow` — no `registerClass`, no new GType;
   the native object stays stock) passed the full probe: construction with
   native props, `instanceof`, signal round-trip identity
   with a custom payload, 500-row churn, clean exit — `scrambleTypePicker.ts`
   uses it. Registering a *new* GType (`registerClass`) is still unproven
   here: probe first if ever needed.
6. **No Cairo text rendering** — node-gtk's toy text API is broken (open bug).
   Use Pango / `Gtk.Label`.

## Conventions

- Import namespaces with the `gi:` scheme: `import Adw from 'gi:Adw-1'`.
- App runs as `node --import tsx --import node-gtk/register src/main.ts`
  (wired up by the npm scripts from the `node-gtk create` scaffold).
- UI layout must be **native GTK4/libadwaita**, not a copy of the csTimer
  webpage layout. Prefer `Adw.OverlaySplitView`, `Adw.Dialog`,
  `Adw.PreferencesDialog`, `Adw.ToastOverlay`, `Adw.StatusPage`.
- **Let adaptive widgets do their job — don't reimplement them.** Before
  writing manual layout/navigation code for an `Adw.*` adaptive widget, check
  what it already does (the `.d.ts` class docs spell it out). The hard-won
  lesson from `scrambleTypePicker.ts`: putting an
  `Adw.NavigationSplitView` in the tree is not the same as *using* it. The
  native pattern is — `Adw.Breakpoint` drives `collapsed`; each
  `Adw.NavigationPage` carries its own `Adw.ToolbarView` + `Adw.HeaderBar` so
  the split view supplies titles and the collapsed back button itself; the
  sidebar is a bare `Adw.Sidebar` with `Adw.SidebarSection`s; and a dialog is
  given a *default* `contentWidth`/`contentHeight` and left to clamp to the
  parent, not resized off a parent-surface `layout` listener. The manual
  version (custom up button,
  manual titles, three render paths, a resize hook) was ~600 lines and still
  looked wrong; the native one is ~300 and correct. If you find yourself
  writing code the widget is documented to provide, stop and delete it.
- **Size preferences scale the tier, they don't replace it**: the three
  scales are inputs to `layoutFor()` in `src/core/layout.ts`, which stays the
  only file allowed to hold a size threshold. Never add a size constant in
  `src/ui/` that a preference could disagree with — `scramblePanel.ts`'s
  duplicated `IMAGE_MAX_WIDTH/HEIGHT` is the existing example.
- **Every action needs a touch path, and touch must not become a second
  input model** (PLAN.md decision 15): gestures call the *same* entry
  points the keyboard does — `timer.keyDown('space', …)` /
  `keyDown('escape', …)`, and the same `remove()` → undo toast → `restore()`
  — so there stays one state machine, one deletion path and one undo. Check
  an action is reachable with no modifier keys and no accelerator before
  shipping it: Shift/Ctrl-click and Escape are the two things a phone does
  not have. Multi-select is the deliberate exception — the list keeps
  GTK's Ctrl/Shift-click and drops the custom touch path; every action on a
  single solve is still reachable by touch.
- **The drawer's edge belongs to the drawer.** While the sidebar is a closed
  drawer, a press in libadwaita's 32px edge-swipe target must not arm the
  timer: `isDrawerEdgePress()` in `core/layout.ts` decides, and the timer
  gesture *denies its sequence* so `Adw.OverlaySplitView` can claim the
  swipe. Skipping `keyDown` alone is not enough — the gesture still owns the
  sequence. While the timer owns the view the show gesture is disabled too,
  since the toggle and Ctrl+B already are. Connect `stopped` (no arguments),
  never `cancel`/`unpaired-release`: those carry a boxed `GdkEventSequence`
  that node-gtk crashes wrapping on ARM. `stopped` also fires on the
  double-click timeout while a stationary finger is down, so the handler
  ignores that one by timing; otherwise a long hold cancels itself. Only a
  press that started on the scramble is cancelled by `stopped` (the scroller
  takes that sequence); a drift on the timer is still a hold. The
  distraction-free layout must also wait until the finger is up: hiding the
  scramble and selector bar moves the timer under the press and cancels the
  touch before its release (`applyTimerFocus()` defers while `pressActive`).
  A collapsed `Adw.OverlaySplitView` built with `show-sidebar=false` can keep
  its `dimming` shield visible because libadwaita leaves `show-progress` at 1;
  hide that shield while the sidebar is closed or it swallows the content's
  touch release.
- **Six relative paths are load-bearing for the packaged layout:**
  `styles.addFile('../style.css', …)` in `src/main.ts`,
  `Gtk.IconTheme.addSearchPath('../data/icons', …)` (the search path holds
  *theme directories*, so it is the **parent** of `hicolor` — pointing it at
  `hicolor` itself finds nothing), the `.ts`/`.js` worker branch in
  `src/scramble/service.ts`, `meta.ts`'s `../../package.json` **and**
  `../../CHANGELOG.md` (the About dialog's release notes are parsed from
  it), and the bare `node-gtk/register` specifier, which resolves **from the
  cwd**, so the `/usr/bin` launcher has to `cd` first. `src/` and `dist/`
  are siblings by design, so one relative path serves both — moving either
  breaks all six. `tools/icon_probe.mjs` checks the icon path headlessly.
- **Probe scripts take app ids under
  `io.github.xlucn.PuzzleTimer.probe.<name>`** — never a personal one
  (`com.oliver.*`) or a stale project one (`org.cstimer.gtk.*`). The id only
  has to be valid and distinct from the app's, for single-instance reasons,
  but it is the one place in `tools/` where the author's name used to leak
  into a released tree.
- Solve list must use `Gtk.ColumnView` (virtualized), never `Gtk.ListBox`
  (builds all rows; sessions can hold thousands of solves).
- **`Gtk.Overlay` children are not counted in the parent's size request**
  (measured) — the right home for a spinner/status that must
  not shift layout: overlay it on the content it annotates
  (`scramblePanel.ts`), never stack it underneath.
- **Accelerator key names are case-sensitive gdk_keyval names** — `'space'`,
  not `'Space'`. A typo fails silently in the UI: the chip renders empty in
  `Adw.ShortcutsDialog` and nothing says why — check a new entry with
  `Gtk.acceleratorParse` (every current entry parses). The upcoming
  `app.importData` / `app.exportData` accelerators (`<Ctrl+O>` /
  `<Ctrl+Shift+S>`) need the same check when they land.
- Statistics rules (ao5/ao12/mo3 trimming, DNF-as-∞, penalties) may be ported
  from csTimer's GPL source (`cs0x7f/cstimer`): port the math, not the DOM.
  The same rule covers csTimer's **data-file format** and its **chart math**
  (evidence in PLAN.md §5). Attribute csTimer and `cstimer_module` in the
  About dialog.
- **Every user-visible string goes through `t()`** (`src/core/i18n.ts`) —
  **M9's rule, not in force yet**: neither `core/i18n.ts` nor `src/locales/`
  exists and `src/ui/` is still full of literals. Once they land: no bare
  literals in `src/ui/`, in the menus, in the toasts or in the
  tooltips. The catalogs are TS modules, not JSON: `src/locales/en.ts` is the
  source of truth and every other locale is typed
  `Record<keyof typeof en, Message>`, so a missing or misspelled key is a
  **compile error**, never a raw key on screen. Times stay in `formatTime`
  (centiseconds are not localised) and the narrow list/edit timestamps stay
  numeric — `Intl.DateTimeFormat` is for dates with room around them.
- **One version, one place**: the app version comes from
  `package.json`, read through `src/platform/meta.ts` — never a literal in
  `main.ts` (a literal drifts from `package.json` the moment either is
  bumped). The About dialog is `Adw.AboutDialog`
  (`Adw.AboutWindow` is deprecated), and its licence enum is
  `Gtk.License.GPL_3_0`, which means *3.0 or later* and matches
  `package.json`'s `GPL-3.0-or-later` (`GPL_3_0_ONLY` does not).
- **Say plainly that AI/LLM assistance was used, and say it early**: the
  README's *AI disclosure* section sits above Features and Install, so a
  reader can decide before installing, and it says who did what, with which
  tools, and how the work was directed. The About dialog's `comments` carries
  the one-line version of the same fact. They are **not** verbatim twins: the
  README can grow a paragraph, the About line cannot — reword one for a new
  fact and check the other still agrees.
- **The licence is stated in four places and they must agree**: `LICENSE`
  (the GPL-3.0 text), `package.json`'s `"license"` field, the README's
  `## License` line, and the About dialog. Dropping any one of them is how a
  public release ends up without a licence.
- **Code comments are for peer developers, not a development diary**
  ([CONTRIBUTING.md](./CONTRIBUTING.md) has the full policy): present tense,
  only what the code cannot say itself — the *why*, a constraint, or a
  one-line gotcha, in the fewest words. Never narrate position, wiring or
  what a call obviously does, and never write dates, "(user call, …)"
  attribution, milestone tags (`M3`, `M6`, …), or "superseded / used to be /
  removed on …" narratives: history belongs in git and
  [PLAN.md](./PLAN.md).
- **User-visible prose is written by hand** — the scope and the list of
  tells to avoid are in [CONTRIBUTING.md](./CONTRIBUTING.md). An agent drafts
  it **into the file** and stops there: the change stays **uncommitted**
  until a person has edited and approved it. Only a typo, a wrong number or
  a stale fact may be fixed and committed directly. Governed: README,
  CHANGELOG, CONTRIBUTING, BUILD, DESIGN, and the in-app strings (About
  `comments`, later the `.desktop` file and the AppStream summary). Exempt as
  working documents: PLAN.md, AGENTS.md, RUST-PORT.md.
- **The hand-written docs speak in the author's first person.** The README
  says "I used AI coding agents", not "the project was developed with". A
  claim earns a concrete example where an adjective would otherwise stand
  (the AI building a widget by hand while libadwaita already has one). A
  feature bullet says what the user gets and leaves the implementation out —
  accuracy figures, prefetching, accelerator lists. Bold marks the term a
  bullet is about and is followed by a colon, never used for emphasis inside
  a sentence. An unfinished area is marked, not hidden ("Currently …").
  `3x3`, not `3×3`, outside the UI.
- **CHANGELOG entries describe what the user gets, not what was built.** The
  summary names the release in plain words and carries **no milestone
  number**; a paragraph is fine when the release deserves one, and it may
  speak in the first person. Bullets are one clause each, in the user's
  language: no rationale, no widget class names or internal identifiers, no
  measurements (those live in PLAN.md), no bold inside a bullet, and
  no tooling or generator work. Admit what is still broken rather than
  leaving it out. `### Project` holds research and process.
- **node-gtk signal handlers**: the emitter is *not* passed as the first
  argument — a handler takes exactly the signal's own parameters — and what it
  returns becomes the signal's return value (that is how a `boolean`-returning
  signal such as `key-pressed` reports "handled"; return `false` to let the
  event keep propagating). Verified against `node-gtk/src/closure.cc`; the
  typed signatures are in `node_modules/.node-gtk-types/*.d.ts` — look up the
  `.on(...)` overload rather than guessing.
- **Adw/Gtk properties are not all plain text — several parse markup.**
  `AdwActionRow:title` does, which is why the type picker's rows set
  `useMarkup: false` (`3x3x3 Roux - LSE <M, U>` otherwise logs a parse
  warning). `AdwAboutDialog:release-notes` parses an **AppStream
  description**, not HTML: only `<p>`, `<ul>`/`<ol>` with `<li>`, `<em>` and
  `<code>` are accepted, an unknown element aborts the whole dialog with a
  GMarkup error instead of being skipped (`Unexpected element 'b'`), there is
  no bold at all (`<em>` is the only emphasis), and text outside a paragraph
  or list item is dropped — so headings carry nothing. Escape user data, or
  set `useMarkup: false` where the property offers it.
- The `gi:*` shims export only a value namespace, so `Gtk.Widget` is **not**
  usable as a type annotation. Let TypeScript infer widget types (see
  `createTimerView()` in `src/ui/`).
- **Never judge a repaint from a raw screenshot**: `XGetImage` on XWayland
  often returns a stale frame and a frozen-looking window proves nothing.
  See `tools/README.md`; trust the app's own state/logs for timing.

## Commands (available after the scaffold)

- `npm run dev` — start app with CSS hot-reload
- `npm start` — start app
- `npm run typecheck` — run after changing TypeScript
- `npm test` — Vitest over `src/core/` **and** `src/platform/`
  (pure logic: timer state machine, stats math, sessions, layout rules,
  scramble feed, store, meta)
- `node --import tsx tools/scramble_probe.ts --quiet` — generates all 206
  scramble types through the real worker (headless, no display needed); expect
  `206/206 types generated`
- `node --import tsx --import node-gtk/register tools/prefs_probe.mjs` —
  drives the real Preferences dialog headlessly; expect `ALL PASS`.
  Bare `--import tsx` dies with `ERR_UNSUPPORTED_ESM_URL_SCHEME` on `gi:` —
  the `node-gtk/register` import is mandatory.
- `node --import tsx --import node-gtk/register tools/breakpoint_probe.mjs`
  — adaptive-layout plumbing on a nested display: breakpoints apply/unapply,
  all five bands fire on every crossing, `Gdk.Surface::layout` reports each
  resize. Its bands come from `core/layout.ts`, and its walk starts 1700 px
  wide, so the nested screen has to be wider than that (`1920x1080`) or the L
  band never fires.
- `node --import tsx --import node-gtk/register tools/icon_probe.mjs` —
  resolves both icon names through the theme; expect `ALL PASS`.

### Manual UI verification (not part of `npm test`)

- **No visual checks unless explicitly told**: do not
  take screenshots or judge pixels yourself — they cost many tokens and are
  slow, and a screenshot of this app proves little (see the XGetImage trap
  below). Verify structure and state instead (typecheck, `npm test`,
  widget-tree/`stderr` dumps), write short **checkpoints for the user** to
  confirm visually, and leave the seeing to them. Only run a visual check when
  asked for one.
- **Drive the app on a nested display**: `Xephyr :99 -screen 1280x800 -ac -br`
  then prefix the app start and every `xtest.py`/`maim` command with
  `DISPLAY=:99`. Synthetic XTEST on the live Wayland session summons GNOME's
  RemoteDesktop consent **even for key taps**, and the unanswered dialog steals
  focus mid-run — on a nested X server XTEST is plain X11
  and never asks. Full recipe: `tools/README.md` → "Recommended workflow".
- **Stop the test app when the run ends.** `pkill -f 'src/main[.]ts'` and
  confirm no instance remains; do not leave it running in Xephyr. If you
  started the nested display for the run, stop that too — the user tests on
  Wayland outside X11.
- `python3 tools/timer_walk.py` — walks the timer through all five states and
  screenshots each; the app must be running on X11
  (`GDK_BACKEND=x11 npm start`).
- `python3 tools/xtest.py --help` — scripted key injection + capture.
- Session UI by keyboard (real accelerators — no clicking needed):
  `<Ctrl+S>` opens the session menu (focus starts on its **first** item, so
  `Down`+`Return` picks the second session), `<Ctrl+N>` new, `F2` rename,
  `<Ctrl>Delete` delete.
- Adaptive-layout walk (keyboard only — full recipe in `tools/README.md`
  → Recipes): `xdotool windowsize --sync` takes **surface** px (the widget is
  10 smaller, CSD shadow), and the app logs every decision to stderr —
  `[layout] WxH … drawer/side-by-side, selectors …` plus `[sidebar]` on each
  state change. `<Ctrl+B>` toggles the list, `Escape` closes the drawer
  (only while one is up). Expected: one line per change, **zero**
  `AdwToastOverlay exceeds …` warnings, and `[layout] 360x294 (win 294)` at
  the floor (xdotool `370×304`; `370×640` gives `360x630`). The same line
  names whether the sidebar is docked and the diagram placement: `diagram wide`
  on a window wider than 540 whose content width is at least 1.4× its height
  with the sidebar hidden, or at least 0.7× its height with it docked;
  `diagram tall-narrow` below that threshold, and
  `diagram none` where a narrow short one sheds it (surface
  360×294/360×360/540×360 shed, 600×360 keeps it). The docked sidebar
  offsets the diagram, so the shown threshold is deliberately looser; the gap
  is measured only while the sidebar is docked, so neither the 800→801 handoff
  nor a collapsing sidebar leaves a stale docked frame. The content area is
  the `mainContent` box between the toolbar bars, so a portrait tablet stacks
  the rows and centres the timer even though its window is wider than 540.
  The picture is flush bottom-right in every live placement.
- Type chooser (same keyboard-only rule): **both layouts open the same
  dialog**. Above 540 the current type shows as the header's
  **title/subtitle** (`Adw.WindowTitle`, centred natively — not a Tab stop)
  and the control is an **icon-only button packed after refresh/copy** —
  walk `Tab` until the focus ring is on it (focus is sticky, so there is no
  fixed stop count; order: sidebar → refresh → copy → select) and press
  `Return`. Below 540 **all four bar controls** — refresh, copy, select and
  the image toggle — move together into `Adw.ToolbarView`'s **bottom
  toolbar** —
  walk `Tab` until the select button's ring is on it and press `Return`. Inside the
  dialog is a plain `Adw.NavigationSplitView`: a "Category" sidebar page and a
  types content page, each with its own `Adw.HeaderBar`. The sidebar is an
  `Adw.Sidebar` whose 44 categories are split into four `Adw.SidebarSection`s
  — csTimer's higher classes (its disabled `===X===` `scrdata` headers;
  `SCRAMBLE_SECTIONS` in core, unit-tested as a partition). Item indices are
  flat across sections, so a group index is still a sidebar item index. The
  type list holds only the browsed category's rows, refilled by the one
  `renderTypes()` when `browse` changes — `Gtk.ListBox.setFilterFunc` over
  all 206 rows costs ≈79ms *per change* through the node-gtk boundary even
  with a trivial predicate (≈0.4ms/row-crossing), while rebuilding
  the ~19 visible rows costs ≈3ms. One render path keyed on `browse` alone —
  layout state never reaches it — and an `Adw.Breakpoint`
  (`max-width: 540px` on the dialog, which clamps to the parent) drives
  `collapsed`. When collapsed the content page's header shows the split view's
  own back button to the category page; selecting a category pushes to its
  types. Navigation, selection and activation are the widgets' own (no custom
  key controllers). There is no search entry; type rows
  show just the type name. A dialog using a breakpoint needs an explicit
  `width-request`/`height-request` minimum (AdwDialog docs) or it logs
  "does not have a minimum size" warnings. CSS: the sidebar's `ListBox` gets
  `navigation-sidebar` (flat rows + selection pill), but its `ScrolledWindow`
  must **not** carry the `view` class — `.view` paints an opaque
  `@view_bg_color` over the split view's muted `.sidebar-pane` background and
  the rail reads as a plain white box. Same on the content
  side: the `boxed-list` `ListBox` draws its own card, so it gets 12px margins
  on all four sides (the frame floats inside the pane) and its scroller drops
  `view` too, else the opaque slab hides the card's rounded frame.
- **If a run looks frozen or the frames look wrong, restart the app and
  redo the measurement**: `pkill -f 'main[.]ts'`, start
  it again, re-drive the step. A stale Xephyr session, a stale capture and a
  genuinely wedged layout all look alike from outside; only a fresh run
  separates them — and the log is what says which. Watch for the pkill
  self-match trap: use a pattern like `main[.]ts` that cannot match your own
  command line.
- **Start the app detached from the tool call**: a
  `(npm start … &)` inside a shell command stays in that command's process
  group, and the group is reaped when the call returns — node then dies with
  **no log line, no core and no journal entry**, which reads exactly like a
  crash. A `setsid` start survives across calls:
  `setsid bash -c 'DISPLAY=:99 GDK_BACKEND=x11 npm start > LOG 2>&1' &`.
  If a death has no `[exit]`/stack of its own, suspect this first — and only
  trust a death *inside* a call (aliveness checks after each step) as an app
  bug.
- Focus anchors (keyboard-only, no pointer): `<Ctrl+S>` then `Escape`
  leaves focus on the **session row** (a popover restores focus to its
  anchor button). From there: `Shift+Tab` → sidebar app menu (then `Return`
  opens it; `Down`×3 + `Return` activates Keyboard Shortcuts — focus
  starts on the menu's first item, and the order is
  Statistics, then Preferences / About / Shortcuts / Quit), `Shift+Tab`×6 →
  the sidebar toggle (chain: app menu, the scramble's scroller — no ring,
  arrow keys scroll a tall one, the label itself is not focusable —,
  image, type, copy, refresh; the header's forward order is
  refresh → copy → select → image, plus a Cancel button at the end
  *only while inspecting*; the scramble controls move into the bottom
  toolbar on a narrow window, but Cancel stays in the header, and the
  centred title (`Adw.WindowTitle`) is not focusable) — `Return` closes the
  sidebar, and `<Ctrl+S>` from that state must reveal it *and* pop the menu
  (the `ensureVisible` path in `src/ui/sessionMenu.ts`). The shortcuts dialog is **not** a
  separate toplevel — `Adw.ShortcutsDialog` draws inside the app's own
  surface, so `xwininfo -root -tree` finds nothing for it: capture it with
  `maim -i 0x<app window id>` and close it with
  `Escape`.
- `node --import tsx --import node-gtk/register tools/keyprobe.mjs` — logs raw
  key events, for key-plumbing bugs.
- Transient frames and focus chains: confirm where a `Shift+Tab` chain
  actually left focus with a single focus-ring `shot` before trusting the
  arithmetic — counts shift whenever a key races a popover popdown. Judge
  a frame only after two shots + `cmp` (`shot` forces a repaint but can
  still return the pre-action frame). To *see* a sub-second state (e.g. a
  scramble generating), widen the window — switch to `4x4x4` (~1.2 s) —
  rather than racing 3x3's ~50 ms; or hand it to the user to watch.
- **Hand interactive testing over early.** If
  synthetic clicks keep landing off-window or the physical mouse keeps
  winning, switch to key-driven checks — and if the user is at the machine,
  ask them to click and watch the result instead of wrestling the warp.
- **Drive the UI by keybindings, never synthetic mouse clicks**: every
  menu/dialog action under test gets an accelerator, and
  tests trigger it with keys. Clicks need GNOME's RemoteDesktop portal
  approval, fight the physical mouse, and menus/popups photograph black
  anyway (tools/README traps 4–5). If an action has no key yet, add one —
  `app.setAccelsForAction(...)` in `src/main.ts` plus an
  `Adw.ShortcutsDialog` entry in `src/ui/shortcuts.ts` — before testing it.
- **Pointer gestures are drivable the same way**: XTEST gives a hold as
  button-down → sleep → button-up, and a drag as button-down plus motion —
  `tools/xtest.py` has `down`/`up`/`drag` for exactly that — so touch work is
  testable with no touch device at all. A click-and-hold in the main content
  is the same drill once **Mouse control** is enabled in Preferences; mouse
  input is off by default, and the gesture is `touchOnly` until then. It is
  the start key: with inspection on, a press turns the readout green and its
  release starts the countdown; a second press-hold-release starts the solve.
  With inspection off, press-hold-release starts it. The decorative diagram
  passes presses through. Pressing start clears the scramble, hint/averages,
  bottom bar and solve list; the list's header toggle and the diagram toggle
  grey out, while the header itself stays. The list's previous open/closed
  state returns when the timer is idle or stopped. Ctrl+B and Ctrl+S are inert
  while the timer owns the view. The solve
  list has no touch gesture: multi-select stays on GTK's Ctrl/Shift-click and
  deletion on the footer's Delete button. The rule above still holds — it is
  about *driving* the app, not about what input the app accepts. Recipes:
  `tools/README.md`.
- Details and traps: `tools/README.md`.

### Fresh install

If `npm install` dies in `postinstall` with
`MODULE_NOT_FOUND .../node-gtk/lib/native.js`, npm blocked the `node-gtk` /
`esbuild` install scripts — the fix (`npm install-scripts approve …`, and the
one-command binding repair) is in [BUILD.md](./BUILD.md) → Fresh install.
Re-approve after bumping either dependency: the allowlist entries are
version-pinned.

## Out of scope (agreed, do not add unprompted)

Bluetooth smart cubes, virtual cube, solvers, and packaging **beyond the AUR
package scheduled as M16**.
Stackmat is a **long-term** goal (see PLAN.md), not current work.

**Scheduled — not out of scope** (PLAN.md §1; don't redesign them, follow the
milestone blocks):
**Queue (2026-10-23): M15** phone-runtime verdict → **M7** size preferences →
**M8** scramble type options (independent of the rest, and its length
control is deliberately **not** persisted) → **M9** i18n → **M10** csTimer
import/export → **M11** records & statistics → **M12** charts → **M16** AUR
package (one blocker left — the repo must be public at tag time; PLAN.md §6
has the draft PKGBUILD and the size
measurements). Numbers are stable identifiers, not positions in the queue:
reorder the queue, never the numbers.

Only **M15** may reopen packaging any further (Flatpak, deb, AppStream).

**Rust port: researched, not scheduled.** [RUST-PORT.md](./RUST-PORT.md)
holds the evidence (six JS engines all reproduce Node's 206 scrambles
byte-for-byte, so the module can be *embedded* rather than ported) and
`tools/rust-embed/run.sh` re-runs it. Do not start a port or a Rust rewrite
without being asked — it is not a milestone.
