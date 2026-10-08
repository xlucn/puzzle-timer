# csTimer GTK

A native Linux cube timer in the spirit of
[csTimer](https://www.cstimer.net/): WCA-legal scrambles for 206 puzzle
types, inspection, sessions, and per-session statistics. Built with GTK 4 +
libadwaita through [node-gtk](https://github.com/romgrk/node-gtk) and
TypeScript — no build step in development.

Architecture, decisions and milestone evidence live in [PLAN.md](./PLAN.md);
project rules in [AGENTS.md](./AGENTS.md).

## Prerequisites

You need GTK ≥ 4.22 and libadwaita — plus their GObject-Introspection data —
installed on your system. node-gtk talks to the libraries you actually have
installed; 4.22 is where GTK ships its own SVG renderer (`Gtk.Svg`), which
draws the scramble diagrams (no librsvg needed).

- **Fedora:** `sudo dnf install gtk4-devel libadwaita-devel gobject-introspection-devel`
- **Debian/Ubuntu:** `sudo apt install libgtk-4-dev libadwaita-1-dev gobject-introspection`
- **Arch:** `sudo pacman -S gtk4 libadwaita gobject-introspection`
- **macOS (Homebrew):** `brew install gtk4 libadwaita gobject-introspection`

The `-dev`/`-devel` packages also ship the `.gir` files used to embed GNOME's API
documentation into the generated TypeScript types (shown on hover in your editor).

You also need **Node.js ≥ 20.6** (for the `gi:` import hooks).

## Getting started

```sh
npm install        # installs deps and generates TypeScript types (postinstall)
npm run dev        # run the app with live reload
```

That's it — a window should appear. Edit `style.css` while it runs and the
window restyles instantly, no restart. To also restart the app when you edit
`src/`, run `npm run dev:app-reload` instead (it adds `node --watch`).

## What it does

- **Timer** — hold Space, release to start, stop on the next press; µs-accurate
  timing and key-repeat safe (the state machine lives in pure TypeScript).
- **WCA inspection** — the first release starts the 15 s countdown (8 s / 12 s
  beeps), the second starts the solve, graded `+2` ≥ 15 s and `DNF` ≥ 17 s;
  Esc cancels. Toggled in Preferences → Timer.
- **Scrambles** — 206 types from `cstimer_module`, always generated off the
  main thread (`worker_threads`) with the next scramble prefetched.
- **Sessions** — create/rename/switch/delete (`Ctrl+S` menu, `Ctrl+N`, `F2`,
  `Ctrl+Delete`); every session owns its solve list, statistics **and its
  current scramble type** (switching restores each one).
- **Statistics & solves** — ao5/ao12/mo3 with csTimer's trimming rules
  (DNF-as-∞), bests and a PB target; penalties `+2`/`DNF`, comments, and an
  edit dialog (`Ctrl+E`, or `Ctrl+1`/`Ctrl+2`/`Ctrl+3` to grade the selected
  solve directly). `Ctrl+T` opens the full Statistics dialog.
- **Keyboard first** — every menu and dialog action has an accelerator; the
  in-app reference is under the sidebar app menu → *Keyboard Shortcuts*.

## How it works

Namespaces are imported with the `gi:` scheme, and their default export is the
namespace object:

```ts
import Gtk from 'gi:Gtk-4.0'
import Adw from 'gi:Adw-1'
```

For those imports to resolve, node-gtk's loader hooks must be installed, which is
why the app is run with `node --import node-gtk/register`. The `dev`/`start`
scripts already include this (along with `tsx`, which runs the TypeScript without
a separate build step). node-gtk integrates the GTK main loop with Node's event
loop automatically.

## Scripts

| command                  | what it does                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| `npm run dev`            | Run with live CSS reload — edit `style.css`, the window restyles, no restart. |
| `npm run dev:app-reload` | Like `dev`, but also restarts the app when you edit `src/` (`node --watch`). |
| `npm start`              | Run once without building.                                        |
| `npm test`               | Vitest over `src/core/` and `src/platform/store.test.ts` — no display needed. |
| `npm run build`          | Type-check and compile `src/` to `dist/` with `tsc`.             |
| `npm run typecheck`      | Type-check only, no output.                                       |
| `npm run generate-types` | (Re)generate TypeScript types for the GI namespaces you use.      |

## Testing

- **Unit:** `npm test` — pure-logic tests only (timer state machine, stats
  math, sessions, scramble feed, store), co-located as `*.test.ts` next to
  their sources. No display server required.
- **UI:** [`tools/`](./tools/README.md) — scripted key/click injection
  (`xtest.py`), a five-state timer walkthrough (`timer_walk.py`) and probes.
  Run the app on a nested X server (`Xephyr :99`) so synthetic input needs no
  portal approval and screenshots stay observable — the README documents the
  traps (stale `XGetImage` frames, duplicate instances, auto-repeat).

## Project structure

```
.
├── src/
│   ├── main.ts          # bootstrap: application, window, header, actions
│   ├── core/            # ★ pure TypeScript — timer, stats, sessions, scrambles
│   ├── scramble/        # worker_threads host for cstimer_module
│   ├── platform/        # Node-only: persistence, CSPRNG, audio out
│   └── ui/              # GTK widgets — the only place that imports gi:*
├── tools/               # UI test harness (see tools/README.md)
│   └── rust-embed/       # research only: run cstimer_module in a Rust JS engine
├── style.css            # custom CSS (hot-reloads live under `npm run dev`)
├── PLAN.md              # architecture, decisions, milestone evidence
├── RUST-PORT.md         # research: embedding the scrambler in Rust vs porting it
├── AGENTS.md            # project rules (auto-loaded by contributing agents)
├── tsconfig.json
└── package.json
```

Tests live beside the code they cover (`src/core/stats.test.ts` …).

## TypeScript types

Types are generated **on your machine** from the GObject-Introspection typelibs
you have installed, so they match your actual library versions and node-gtk's
runtime shape (camelCase methods, typed signals, nullability, …). They live in
`node_modules/.node-gtk-types/` (git-ignored) and `tsconfig.json` points at them.

The `postinstall` script regenerates them automatically. If you start using
another library, add it to the `generate-types` script in `package.json` and
re-run it:

```jsonc
// package.json
"generate-types": "node-gtk generate-types Gtk-4.0 Adw-1 GtkSource-5"
```

```sh
npm run generate-types
```

## How this was written

Written with the assistance of AI/LLM tools.

## License

GPL-3.0-or-later — see [LICENSE](./LICENSE). Not a preference: this project
ports GPL-3.0 code from
[csTimer](https://github.com/cs0x7f/cstimer) (scramble generation via
`cstimer_module`, statistics rules) — the About dialog credits both.

## Learn more

- [node-gtk](https://github.com/romgrk/node-gtk) — the bindings
- [Importing libraries](https://github.com/romgrk/node-gtk/blob/master/doc/importing.md) — the `gi:` scheme and ESM details
- [GTK 4 API reference](https://docs.gtk.org/gtk4/)
- [libadwaita API reference](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/)
- [Adwaita style classes](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/main/style-classes.html)
