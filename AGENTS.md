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

## Commands (available after the M0 scaffold)

- `npm run dev` — start app with CSS hot-reload
- `npm start` — start app
- `npm run typecheck` — run after changing TypeScript
- `npm test` — run Vitest on `src/core/`

## Out of scope (agreed, do not add unprompted)

Bluetooth smart cubes, virtual cube, solvers, backup import/export, packaging.
Stackmat and charts are **long-term** goals (see PLAN.md), not current work.
