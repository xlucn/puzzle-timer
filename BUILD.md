# Building and running Puzzle Timer

Everything here assumes a source checkout. For what the app *is*, see the
[README](./README.md).

## Prerequisites

GTK ≥ 4.22 and libadwaita, plus their GObject-Introspection data. node-gtk
talks to the libraries you actually have installed; 4.22 is where GTK ships
its own SVG renderer (`Gtk.Svg`), which draws the scramble diagrams (no
librsvg needed).

- **Fedora:** `sudo dnf install gtk4-devel libadwaita-devel gobject-introspection-devel`
- **Debian/Ubuntu:** `sudo apt install libgtk-4-dev libadwaita-1-dev gobject-introspection`
- **Arch:** `sudo pacman -S gtk4 libadwaita gobject-introspection`
- **macOS (Homebrew):** `brew install gtk4 libadwaita gobject-introspection`

The `-dev`/`-devel` packages also ship the `.gir` files used to embed GNOME's
API documentation into the generated TypeScript types (shown on hover in your
editor).

You also need **Node.js ≥ 20.6** (for the `gi:` import hooks).

## Fresh install

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
| `npm test`               | Vitest over `src/core/` and `src/platform/` — no display needed. |
| `npm run build`          | Type-check and compile `src/` to `dist/` with `tsc`.             |
| `npm run typecheck`      | Type-check only, no output.                                       |
| `npm run generate-types` | (Re)generate TypeScript types for the GI namespaces you use.      |

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
"generate-types": "node-gtk generate-types Gtk-4.0 Adw-1"
```

```sh
npm run generate-types
```

## Testing

- **Unit:** `npm test` — pure-logic tests only (timer state machine, stats
  math, sessions, scramble feed, store), co-located as `*.test.ts` next to
  their sources. No display server required.
- **UI:** [`tools/`](./tools/README.md) — scripted key/click injection
  (`xtest.py`), a five-state timer walkthrough (`timer_walk.py`) and probes.
  Run the app on a nested X server (`Xephyr :99`) so synthetic input needs no
  portal approval and screenshots stay observable — that README documents the
  traps (stale `XGetImage` frames, duplicate instances, auto-repeat).
- **Headless scramble check:** `node --import tsx tools/scramble_probe.ts
  --quiet` generates all 206 scramble types through the real worker; expect
  `206/206 types generated`.
- **Icon check:** `node --import tsx --import node-gtk/register
  tools/icon_probe.mjs` resolves both icon names through the theme; expect
  `ALL PASS`.

## Learn more

- [node-gtk](https://github.com/romgrk/node-gtk) — the bindings
- [Importing libraries](https://github.com/romgrk/node-gtk/blob/master/doc/importing.md) — the `gi:` scheme and ESM details
- [GTK 4 API reference](https://docs.gtk.org/gtk4/)
- [libadwaita API reference](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/)
- [Adwaita style classes](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/main/style-classes.html)
