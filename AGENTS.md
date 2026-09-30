# cstimer-gtk — project instructions

Native Linux cube timer (csTimer-like), built with GTK4 + libadwaita.
Full plan, technical decisions, and research evidence: **[PLAN.md](./PLAN.md)**.

## Stack (decided — do not re-litigate without being asked)

- **UI:** `node-gtk` (GObject introspection bindings) + GTK4 + libadwaita
- **Language:** TypeScript, run via `tsx` (no separate build step in dev)
- **Scrambles:** `cstimer_module` (official csTimer package) running in a `worker_threads` worker
- **Tests:** Vitest, on pure core modules only
- **License:** GPL-3.0 (mandatory — `cstimer_module` and csTimer source are GPL-3.0)

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
- `npm test` — run Vitest on `src/core/`
- `node --import tsx tools/scramble_probe.ts --quiet` — generates all 206
  scramble types through the real worker (headless, no display needed); expect
  `206/206 types generated`

### Manual UI verification (not part of `npm test`)

- `python3 tools/timer_walk.py` — walks the timer through all five states and
  screenshots each; the app must be running on X11
  (`GDK_BACKEND=x11 npm start`).
- `python3 tools/xtest.py --help` — scripted key injection + capture.
- `node --import tsx --import node-gtk/register tools/keyprobe.mjs` — logs raw
  key events, for key-plumbing bugs.
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
