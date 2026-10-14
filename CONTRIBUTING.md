# Contributing

This is a small, opinionated codebase with a strong bias toward *native*,
*testable*, and *keyboard-drivable*. If you want to change it, read this
first — most of the rules below exist because something already went wrong
once without them.

## Where things live

| File | What it holds |
| --- | --- |
| [README.md](./README.md) | What the app is and how to install it — user-facing only |
| [BUILD.md](./BUILD.md) | Build, run, and test from source in detail |
| [DESIGN.md](./DESIGN.md) | The current architecture and the decisions behind it |
| [PLAN.md](./PLAN.md) | The historical record: milestones, decisions, measurements |
| [AGENTS.md](./AGENTS.md) | The full rule set the AI agents follow — **these apply to human contributors too** |
| [tools/README.md](./tools/README.md) | The scripted UI-verification harness and its traps |

This file does not duplicate the rules; it points at them. When a rule and
this file disagree, `AGENTS.md` is the source of truth.

## The rules that matter most

These are lifted from `AGENTS.md`; see that file for the full list and the
reasoning behind each.

- **`src/core/` is pure TypeScript.** No `gi:*`, no Node-only APIs. It must
  stay unit-testable without a display server.
- **Only `src/ui/` touches `gi:*`.** Node-specific code lives in
  `src/platform/` and `src/scramble/`.
- **Scramble generation never runs on the main thread.** A 4×4 WCA scramble
  takes ~1.2 s and would freeze the UI.
- **Every action needs a touch path, and touch must not become a second input
  model.** Gestures call the same entry points the keyboard does.
- **Statistics rules may be ported from csTimer's GPL source — the math, not
  the DOM.** The same applies to its data-file format and its chart math.
  Attribute csTimer and `cstimer_module` in the About dialog.
- **Every user-visible string goes through `t()`** (`src/core/i18n.ts`), no
  bare literals in `src/ui/`, the menus, the toasts, or the tooltips.
- **Solve lists use `Gtk.ColumnView`**, never `Gtk.ListBox` — sessions can
  hold thousands of solves.
- **Let adaptive widgets do their job.** Before writing manual
  layout/navigation code for an `Adw.*` adaptive widget, check what it
  already does. If you find yourself writing code the widget is documented to
  provide, stop and delete it.
- **No Cairo text rendering** — node-gtk's toy text API is broken. Use Pango
  / `Gtk.Label`.

## Code comments

Comments are written for a peer developer reading the code for the first
time, not as a development diary.

- **Present tense, current state.** Explain what the code does and the one
  key reason it is that way.
- **Say only what the code cannot.** Do not narrate what the code or its
  syntax already shows — a `packStart()` call says where a button lives, a
  function name says what it does. Position, wiring and feature restatement
  are noise; the comment earns its place with the *why*, a constraint, or a
  gotcha. Fewest words that carry it.
- **Gotchas and workarounds are one line**, stating the fact, not the
  investigation: `// set_text is unintrospectable in the Gdk binding, so
  // the clipboard takes a content provider instead` — not a catalogue of
  the gir attributes that were checked.
- **No history.** No dates, no "(user call, …)" attribution, no milestone
  tags (`M3`, `M6`, …), no "superseded / used to be / removed on …"
  narratives. The history lives in git and in `PLAN.md`; if a past decision
  matters, state the *constraint* it imposes today, not the story of how it
  was reached.
- **Keep the gotchas that are still true.** A GTK/node-gtk quirk the code
  works around, or a measured fact that pins a constant, is exactly what a
  comment is for — just state it without the date.
- **Module headers describe the module's current job**, not how the module
  grew.

## Workflow

```sh
npm run typecheck   # after every TypeScript change
npm test            # 200+ tests over the pure core — no display needed
```

For UI changes, drive the app on a nested X server rather than the live
desktop — `tools/README.md` has the recipe and the list of traps. Prefer
keyboard accelerators over synthetic mouse clicks in tests.

Commits follow the existing style: conventional-commit prefix
(`feat:`, `fix:`, `refactor:`, `docs:`, `test:`), a short scope in
parentheses when it helps, and a subject line that says what changed and, when
useful, why.
