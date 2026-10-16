# csTimer GTK

A native Linux cube timer in the spirit of
[csTimer](https://www.cstimer.net/): WCA-legal scrambles for 206 puzzle
types, inspection, sessions, and per-session statistics. Built with GTK 4 +
libadwaita — a real desktop app, not a web page in a shell.

## Install

You need GTK ≥ 4.22 and libadwaita (with their GObject-Introspection data),
plus **Node.js ≥ 20.6**.

- **Fedora:** `sudo dnf install gtk4-devel libadwaita-devel gobject-introspection-devel`
- **Debian/Ubuntu:** `sudo apt install libgtk-4-dev libadwaita-1-dev gobject-introspection`
- **Arch:** `sudo pacman -S gtk4 libadwaita gobject-introspection`
- **macOS (Homebrew):** `brew install gtk4 libadwaita gobject-introspection`

Then:

```sh
npm install   # installs dependencies and generates TypeScript types
npm start     # run the app
```

A window should appear. `npm run dev` additionally hot-reloads `style.css`
while the app runs — edit, save, and the window restyles instantly.

## What it does

- **Timer** — hold Space, release to start, stop on the next press; µs-accurate
  timing and key-repeat safe.
- **WCA inspection** — the first release starts the 15 s countdown (8 s / 12 s
  beeps), the second starts the solve, graded `+2` ≥ 15 s and `DNF` ≥ 17 s;
  Esc cancels. Toggled in Preferences → Timer.
- **Scrambles** — 206 puzzle types (3×3 through megaminx, square-1, clock,
  multi-blind relays …), always WCA-legal, generated off the main thread so
  the timer never stutters, with the next scramble prefetched.
- **Sessions** — create/rename/switch/delete (`Ctrl+S` menu, `Ctrl+N`, `F2`,
  `Ctrl+Delete`); every session owns its solve list, statistics **and its
  current scramble type** (switching restores each one). Everything is saved
  to disk automatically and survives restarts.
- **Statistics & solves** — ao5/ao12/mo3 with the official trimming rules,
  bests and a PB target; penalties `+2`/`DNF`, comments, and an edit dialog
  (`Ctrl+E`, or `Ctrl+1`/`Ctrl+2`/`Ctrl+3` to grade the selected solve
  directly). `Ctrl+T` opens the full Statistics dialog.
- **Keyboard first** — every menu and dialog action has an accelerator; the
  in-app reference is under the sidebar app menu → *Keyboard Shortcuts*.
- **Dark mode** — follows the system, or forced in Preferences → Appearance.

## How this was written

Written with the assistance of AI/LLM tools.

## Changelog

Every stage is tagged and described in [CHANGELOG.md](./CHANGELOG.md).
`0.0.x` marks internal stages — one per milestone that has landed — and
`0.1.0` will be the first public source release. The same file feeds the
About dialog's release notes.

## License

GPL-3.0-or-later — see [LICENSE](./LICENSE). Not a preference: this project
ports GPL-3.0 code from
[csTimer](https://github.com/cs0x7f/cstimer) (scramble generation via
`cstimer_module`, statistics rules) — the About dialog credits both.

## More documentation

| File | For |
| --- | --- |
| [BUILD.md](./BUILD.md) | Building, running, and testing from source in detail |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | How to contribute — conventions and workflow |
| [DESIGN.md](./DESIGN.md) | How the code is structured, and why |
| [PLAN.md](./PLAN.md) | The project's development history and milestone record |
| [CHANGELOG.md](./CHANGELOG.md) | What changed, in each tagged stage |
| [AGENTS.md](./AGENTS.md) | Rules the AI coding agents follow in this repo |
| [tools/README.md](./tools/README.md) | The scripted UI-verification harness |
