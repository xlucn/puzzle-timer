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
3. **Only `src/ui/` touches `gi:*`** (Gtk, Adw, GLib, Gio, Rsvg, Gst).
4. **Scramble generation never runs on the main thread.** A 4x4 WCA scramble
   takes ~1.2 s (measured) and would freeze the UI.
5. **No custom `Gtk.Widget` subclassing** (`registerClass`) — node-gtk has
   open segfault bugs there. Use stock widgets + CSS classes.
6. **No Cairo text rendering** — node-gtk's toy text API is broken (open bug).
   Use Pango / `Gtk.Label`.

## Conventions

- Import namespaces with the `gi:` scheme: `import Adw from 'gi:Adw-1'`.
- App runs as `node --import tsx --import node-gtk/register src/main.ts`
  (wired up by the npm scripts from the `node-gtk create` scaffold).
- UI layout must be **native GTK4/libadwaita**, not a copy of the csTimer
  webpage layout. Prefer `Adw.OverlaySplitView`, `Adw.Dialog`,
  `Adw.PreferencesDialog`, `Adw.ToastOverlay`, `Adw.StatusPage`.
- Solve list must use `Gtk.ColumnView` (virtualized), never `Gtk.ListBox`
  (builds all rows; sessions can hold thousands of solves).
- **`Gtk.Overlay` children are not counted in the parent's size request**
  (measured, 2026-10-01) — the right home for a spinner/status that must
  not shift layout: overlay it on the content it annotates
  (`scramblePanel.ts`), never stack it underneath.
- **Accelerator key names are case-sensitive gdk_keyval names** — `'space'`,
  not `'Space'`. A typo fails silently in the UI: the chip renders empty in
  `Adw.ShortcutsDialog` and nothing says why — check a new entry with
  `Gtk.acceleratorParse` (all 18 currently return ok, 2026-10-02).
- Statistics rules (ao5/ao12/mo3 trimming, DNF-as-∞, penalties) may be ported
  from csTimer's GPL source (`cs0x7f/cstimer`): port the math, not the DOM.
  Attribute csTimer and `cstimer_module` in the About dialog.
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
  (207 tests — M6's layout/timer-nudge rules plus the per-solve ao5/ao12
  columns; older counts: 180 at M5, 203 at M6)
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
  `AdwToastOverlay exceeds …` warnings, and `[layout] 390x350 (win 350)` at
  the 400×360 floor.
- Narrow type chooser (same keyboard-only rule): in row mode the selectors are
  one `Adw.ButtonRow` **at the bottom of the main area** — walk `Shift+Tab`
  until the focus ring is on it (≈5 stops with the drawer closed) and press
  `Return`. Inside the dialog `Shift+Tab` cycles list → search entry → up
  button; arrows and `Return` pick (bound by the dialog, not by GTK — see
  PLAN §7); `Escape` clears the query first and closes second.
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
  app-functions ⋮, copy, refresh, type, category) — `Return` closes the
  sidebar, and `<Ctrl+S>`
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

Bluetooth smart cubes, virtual cube, solvers, backup import/export, packaging.
Stackmat and charts are **long-term** goals (see PLAN.md), not current work.
