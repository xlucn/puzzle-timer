# cstimer-gtk — project instructions

Native Linux cube timer (csTimer-like), built with GTK4 + libadwaita.
Full plan, technical decisions, and research evidence: **[PLAN.md](./PLAN.md)**.

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
5. **Custom widget subclassing: try it, probe it, fall back if it fails**
   (user call, 2026-10-05 — replaces an earlier blanket ban). If
   subclassing is the easy way, attempt it; verify with a *runtime* probe
   before trusting it (typecheck proves nothing about GObject behavior); if
   it segfaults or signal payloads come back as bare wrappers, drop it for
   maps/closures and record the failure here. Plain JS wrapper extension
   (`class MyRow extends Adw.ActionRow` — no `registerClass`, no new GType;
   the native object stays stock) passed the full probe on 2026-10-05:
   construction with native props, `instanceof`, signal round-trip identity
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
  lesson from `scrambleTypePicker.ts` (2026-10-05): putting an
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
- **Size preferences scale the tier, they don't replace it** (M7): the three
  scales are inputs to `layoutFor()` in `src/core/layout.ts`, which stays the
  only file allowed to hold a size threshold. Never add a size constant in
  `src/ui/` that a preference could disagree with — `scramblePanel.ts`'s
  duplicated `IMAGE_MAX_WIDTH/HEIGHT` is the existing example, and M7 deletes
  it.
- **Every action needs a touch path, and touch must not become a second
  input model** (M13; PLAN.md decision 15): gestures call the *same* entry
  points the keyboard does — `timer.keyDown('space', …)` /
  `keyDown('escape', …)`, and the same `remove()` → undo toast → `restore()`
  — so there stays one state machine, one deletion path and one undo. Check
  an action is reachable with no modifier keys and no accelerator before
  shipping it: Shift/Ctrl-click and Escape are the two things a phone does
  not have.
- **Four relative paths are load-bearing for the packaged layout (M15):**
  `styles.addFile('../style.css', …)` in `src/main.ts`, the
  `.ts`/`.js` worker branch in `src/scramble/service.ts`, `meta.ts`'s
  `../../package.json`, and the bare `node-gtk/register` specifier — which
  resolves **from the cwd**, so the `/usr/bin` launcher has to `cd` first.
  `src/` and `dist/` are siblings by design: moving either breaks all of
  them. All four were verified working from `dist/` on 2026-10-06.
- Solve list must use `Gtk.ColumnView` (virtualized), never `Gtk.ListBox`
  (builds all rows; sessions can hold thousands of solves).
- **`Gtk.Overlay` children are not counted in the parent's size request**
  (measured, 2026-10-01) — the right home for a spinner/status that must
  not shift layout: overlay it on the content it annotates
  (`scramblePanel.ts`), never stack it underneath.
- **Accelerator key names are case-sensitive gdk_keyval names** — `'space'`,
  not `'Space'`. A typo fails silently in the UI: the chip renders empty in
  `Adw.ShortcutsDialog` and nothing says why — check a new entry with
  `Gtk.acceleratorParse` (all 18 currently return ok, 2026-10-02). M9 adds
  `app.importData` / `app.exportData` on `<Ctrl+O>` / `<Ctrl+Shift+S>` (both
  free as of 2026-10-05): re-run the check and update the count when they
  land.
- Statistics rules (ao5/ao12/mo3 trimming, DNF-as-∞, penalties) may be ported
  from csTimer's GPL source (`cs0x7f/cstimer`): port the math, not the DOM.
  The same rule covers csTimer's **data-file format** (M9 —
  `src/core/csTimerFormat.ts`, evidence in PLAN.md §5) and its **chart math**
  (M11). Attribute csTimer and `cstimer_module` in the About dialog.
- **Every user-visible string goes through `t()`** (M8, `src/core/i18n.ts`) —
  no bare literals in `src/ui/`, in the menus, in the toasts or in the
  tooltips. The catalogs are TS modules, not JSON: `src/locales/en.ts` is the
  source of truth and every other locale is typed
  `Record<keyof typeof en, Message>`, so a missing or misspelled key is a
  **compile error**, never a raw key on screen. Times stay in `formatTime`
  (centiseconds are not localised) and the narrow list/edit timestamps stay
  numeric — `Intl.DateTimeFormat` is for dates with room around them (the
  M10 PB history).
- **One version, one place** (M12): the app version comes from
  `package.json`, read through `src/platform/meta.ts` — never a literal in
  `main.ts` (the About dialog's hardcoded `'0.1.0'` is exactly the bug that
  rule prevents). The About dialog is `Adw.AboutDialog`
  (`Adw.AboutWindow` is deprecated), and its licence enum is
  `Gtk.License.GPL_3_0`, which means *3.0 or later* and matches
  `package.json`'s `GPL-3.0-or-later` (`GPL_3_0_ONLY` does not).
- **Say plainly that AI/LLM assistance was used** (user call, 2026-10-05):
  the README's *How this was written* section and the About dialog's
  `comments` line both carry it. Reword one and you reword both — they are
  the same statement in two places.
- **node-gtk signal handlers**: the emitter is *not* passed as the first
  argument — a handler takes exactly the signal's own parameters — and what it
  returns becomes the signal's return value (that is how a `boolean`-returning
  signal such as `key-pressed` reports "handled"; return `false` to let the
  event keep propagating). Verified against `node-gtk/src/closure.cc`; the
  typed signatures are in `node_modules/.node-gtk-types/*.d.ts` — look up the
  `.on(...)` overload rather than guessing.
- The `gi:*` shims export only a value namespace, so `Gtk.Widget` is **not**
  usable as a type annotation. Let TypeScript infer widget types (see
  `createTimerView()` in `src/ui/`).
- **Never judge a repaint from a raw screenshot**: `XGetImage` on XWayland
  often returns a stale frame and a frozen-looking window proves nothing.
  See `tools/README.md`; trust the app's own state/logs for timing.

## Commands (available after the M0 scaffold)

- `npm run dev` — start app with CSS hot-reload
- `npm start` — start app
- `npm run typecheck` — run after changing TypeScript
- `npm test` — Vitest over `src/core/` **and** `src/platform/store.test.ts`
  (198 tests — M6's layout rules, the removal of `headerSlack`, plus the
  per-solve ao5/ao12 columns and the sidebar-section partition; older counts:
  180 at M5, 207 before 2026-10-03, 219 before 2026-10-04, 217 before the
  timer nudge was dropped 2026-10-05)
- `node --import tsx tools/scramble_probe.ts --quiet` — generates all 206
  scramble types through the real worker (headless, no display needed); expect
  `206/206 types generated`
- `node --import tsx --import node-gtk/register tools/prefs_probe.mjs` —
  drives the real Preferences dialog headlessly (M5); expect `ALL PASS`.
  Bare `--import tsx` dies with `ERR_UNSUPPORTED_ESM_URL_SCHEME` on `gi:` —
  the `node-gtk/register` import is mandatory.
- `node --import tsx --import node-gtk/register tools/breakpoint_probe.mjs`
  — M6 plumbing on a nested display: breakpoints apply/unapply, all five
  bands fire on every crossing, `Gdk.Surface::layout` reports each resize.

### Manual UI verification (not part of `npm test`)

- **No visual checks unless explicitly told** (user call, 2026-10-05): do not
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
  focus mid-run (probes, 2026-10-02) — on a nested X server XTEST is plain X11
  and never asks. Full recipe: `tools/README.md` → "Recommended workflow".
- `python3 tools/timer_walk.py` — walks the timer through all five states and
  screenshots each; the app must be running on X11
  (`GDK_BACKEND=x11 npm start`).
- `python3 tools/xtest.py --help` — scripted key injection + capture.
- Session UI by keyboard (M3's real accelerators — no clicking needed):
  `<Ctrl+S>` opens the session menu (focus starts on its **first** item, so
  `Down`+`Return` picks the second session), `<Ctrl+N>` new, `F2` rename,
  `<Ctrl>Delete` delete.
- Adaptive-layout walk (M6, keyboard only — full recipe in `tools/README.md`
  → Recipes): `xdotool windowsize --sync` takes **surface** px (the widget is
  10 smaller, CSD shadow), and the app logs every decision to stderr —
  `[layout] WxH … drawer/side-by-side, selectors …` plus `[sidebar]` on each
  state change. `<Ctrl+B>` toggles the list, `Escape` closes the drawer
  (only while one is up). Expected: one line per change, **zero**
  `AdwToastOverlay exceeds …` warnings, and `[layout] 350x350 (win 350)` at
  the 360×360 floor (360×640 gives `350x630`).
- Type chooser (same keyboard-only rule): **both layouts open the same
  dialog** (2026-10-04). Above 600 the current type shows as the header's
  **title/subtitle** (`Adw.WindowTitle`, centred natively — not a Tab stop)
  and the control is an **icon-only button packed after refresh/copy** —
  walk `Tab` until the focus ring is on it (focus is sticky, so there is no
  fixed stop count; order: sidebar → refresh → copy → select) and press
  `Return`. Below 600 **all four bar controls** — refresh, copy, select and
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
  with a trivial predicate (≈0.4ms/row-crossing, measured 2026-10-06; it was
  most of the slow popup and ran twice per category click), while rebuilding
  the ~19 visible rows costs ≈3ms. One render path keyed on `browse` alone —
  layout state never reaches it — and an `Adw.Breakpoint`
  (`max-width: 600px` on the dialog, which clamps to the parent) drives
  `collapsed`. When collapsed the content page's header shows the split view's
  own back button to the category page; selecting a category pushes to its
  types. Navigation, selection and activation are the widgets' own (no custom
  key controllers). There is no search entry (dropped 2026-10-05); type rows
  show just the type name. A dialog using a breakpoint needs an explicit
  `width-request`/`height-request` minimum (AdwDialog docs) or it logs
  "does not have a minimum size" warnings. CSS: the sidebar's `ListBox` gets
  `navigation-sidebar` (flat rows + selection pill), but its `ScrolledWindow`
  must **not** carry the `view` class — `.view` paints an opaque
  `@view_bg_color` over the split view's muted `.sidebar-pane` background and
  the rail reads as a plain white box (fixed 2026-10-05). Same on the content
  side: the `boxed-list` `ListBox` draws its own card, so it gets 12px margins
  on all four sides (the frame floats inside the pane) and its scroller drops
  `view` too, else the opaque slab hides the card's rounded frame.
- **If a run looks frozen or the frames look wrong, restart the app and
  redo the measurement** (user, 2026-10-02): `pkill -f 'main[.]ts'`, start
  it again, re-drive the step. A stale Xephyr session, a stale capture and a
  genuinely wedged layout all look alike from outside; only a fresh run
  separates them — and the log is what says which. Watch for the pkill
  self-match trap: use a pattern like `main[.]ts` that cannot match your own
  command line.
- **Start the app detached from the tool call** (measured 2026-10-03): a
  `(npm start … &)` inside a shell command stays in that command's process
  group, and the group is reaped when the call returns — node then dies with
  **no log line, no core and no journal entry**, which reads exactly like a
  crash. Running the identical command by hand left the app alive (user's
  control), and a `setsid` start survived across calls:
  `setsid bash -c 'DISPLAY=:99 GDK_BACKEND=x11 npm start > LOG 2>&1' &`.
  If a death has no `[exit]`/stack of its own, suspect this first — and only
  trust a death *inside* a call (aliveness checks after each step) as an app
  bug.
- Layout-F anchors (keyboard-only, no pointer): `<Ctrl+S>` then `Escape`
  leaves focus on the **session row** (a popover restores focus to its
  anchor button). From there: `Shift+Tab` → sidebar app menu (then `Return`
  opens it; `Down`+`Return` activates Keyboard Shortcuts), `Shift+Tab`×7 →
  the sidebar toggle (chain: app menu, the scramble's scroller — no ring,
  arrow keys scroll a tall one, the label itself is not focusable —,
  app-functions ⋮, image, type, copy, refresh; the header segment is measured
  2026-10-08 — forward order is refresh → copy → select → image → ⋮, the
  image toggle is a stop since that day, and the centred title
  (`Adw.WindowTitle`) is not focusable; a pre-M4 ×7 reached the same count
  via a category dropdown that M4 merged) — `Return` closes the sidebar, and `<Ctrl+S>`
  from that state must reveal it *and* pop the menu (the `ensureVisible`
  path in `src/ui/sessionMenu.ts`). The shortcuts dialog is **not** a
  separate toplevel — `Adw.ShortcutsDialog` draws inside the app's own
  surface (the `Gtk.ShortcutsWindow` it replaced was a toplevel, so the old
  recipe of `xwininfo -root -tree | grep "Keyboard Shortcuts"` now finds
  nothing): capture it with `maim -i 0x<app window id>` and close it with
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
- **Hand interactive testing over early.** "There is too much time debugging
  the testers … find a solution quick, or I can help testing" (user, M2): if
  synthetic clicks keep landing off-window or the physical mouse keeps
  winning, switch to key-driven checks — and if the user is at the machine,
  ask them to click and watch the result instead of wrestling the warp.
- **Drive the UI by keybindings, never synthetic mouse clicks** (user,
  2026-10-01): every menu/dialog action under test gets an accelerator, and
  tests trigger it with keys. Clicks need GNOME's RemoteDesktop portal
  approval, fight the physical mouse, and menus/popups photograph black
  anyway (tools/README traps 4–5). If an action has no key yet, add one —
  `app.setAccelsForAction(...)` in `src/main.ts` plus an
  `Adw.ShortcutsDialog` entry in `src/ui/shortcuts.ts` — before testing it.
- **Gestures are drivable the same way** (M13): XTEST gives a long-press as
  button-down → sleep → button-up, and a swipe as button-down plus motion,
  so touch work is testable with no touch device at all. The rule above
  still holds — it is about *driving* the app, not about what input the app
  accepts.
- Details and traps: `tools/README.md`.

### Fresh install

`package.json` carries an `allowScripts` allowlist for `node-gtk` and
`esbuild`. Without it npm blocks their install scripts: `npm install` dies in
`postinstall` with `MODULE_NOT_FOUND .../node-gtk/lib/native.js` and the app
cannot start. The entries are version-pinned, so after bumping either
dependency re-approve them:

```sh
npm install-scripts approve node-gtk
npm install-scripts approve esbuild
```

If the install is already broken and you only want the native binding back:

```sh
(cd node_modules/node-gtk && npx node-pre-gyp install --fallback-to-build)
npm run generate-types
```

## Out of scope (agreed, do not add unprompted)

Bluetooth smart cubes, virtual cube, solvers, and packaging **beyond the AUR
package scheduled as M15**.
Stackmat is a **long-term** goal (see PLAN.md), not current work.

**Scheduled — not out of scope** (PLAN.md §1; don't redesign them, follow the
milestone blocks):
**M7** size preferences → **M8** i18n → **M9** csTimer import/export →
**M10** records & statistics → **M11** charts → **M12** release readiness →
**M13** touch input → **M14** phone-runtime verdict → **M15** AUR package
(added 2026-10-06; blocked on M12 — PLAN.md §6 has the draft PKGBUILD and
the size measurements).
csTimer backup import/export used to be listed above as dropped; it was
reinstated by that decision, and charts came off the long-term list with it.

Only **M14** may reopen packaging any further (Flatpak, deb, AppStream).

**Rust port: researched, not scheduled.** [RUST-PORT.md](./RUST-PORT.md)
holds the evidence (four JS engines all reproduce Node's 206 scrambles
byte-for-byte, so the module can be *embedded* rather than ported) and
`tools/rust-embed/run.sh` re-runs it. Do not start a port or a Rust rewrite
without being asked — it is not a milestone.
