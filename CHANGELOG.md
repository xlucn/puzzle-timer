# Changelog

Notable changes to this project, most recent first.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Support starting the timer by click-hold-release of a mouse or
  press-hold-release of a finger anywhere in the main area.
- Support stopping the timer by clicking with the mouse or tapping with the finger.
- Mouse control is opt-in; touch and the keyboard work without it.
- Added a Cancel button during inspection.
- Distraction free from the first start press through the solve: the scramble,
  diagram, hints, averages and solve list step aside, leaving the timer and
  header.

### Changed

- Starting an inspection no longer needs a held key, click or touch;
  releasing starts the countdown.

### Fixed

- The scramble diagram no longer covers the timer on a short, narrow window.

## [0.1.0] — 2026-10-22

First release ready for public use.

### Added

- The icon is updated, and there is a symbolic variant for small sizes.
- A desktop entry.

### Changed

- The app name changed to Puzzle Timer.

## [0.0.8] — 2026-10-16

**This release mainly contains improvements to features in previous releases.**

All the code before this release was written nearly automatically by AI agents.
Some features are not implemented as I intended, and some have bugs. I spent
some time playing with the app and fixing the issues I found. Of course, the
code is still written by AI agents, but I have more hand-holding and testing.

As of this release, the app is much more polished and usable.

### Added

- The solve list in the sidebar shows ao5 and ao12.
- The solve edit dialog is completely reworked with libadwaita widgets.
- A header button to copy the scramble texts.
- A header button to change the puzzle type, replacing the two drop-down
  buttons. It triggers a pop-up dialog. The puzzle category and type are shown
  as the window header's title and subtitle.
- A header button to toggle the scramble image.
- All app menu items now go in the sidebar.
- Scramble diagrams render with `Gtk.Svg` instead of `Rsvg`.
- An icon. But it's going to change again, because I want to make it follow
  GNOME's HIG (Human Interface Guidelines).

### Changed

- The timer layout has been adjusted. Now it centers in available space. But
  there is still an issue of it being covered by the scramble image, waiting
  for a better solution.
- The type picker performance has been improved.
- Better adaptive layout behaviour for phone form factors and especially for
  horizontal orientation. Type picker can show two columns in phone's horizontal
  orientation, hence more space efficiency.
- The sidebar does not expand over 320 px now.
- New `BUILD.md`, `CONTRIBUTING.md` and `DESIGN.md`.

### Fixed

- The Statistics table adapts to a narrow window for phone form factor.

### Project

- Research into embedding `cstimer_module` in a Rust — six JS engines reproduce
  206 scrambles byte for byte. Recorded in `RUST-PORT.md`; not scheduled.

## [0.0.7] — 2026-10-02

**Adaptive layout.**

- The solve list becomes a drawer for narrow window.
- The header adapts instead of truncating.
- Phone form factor considerations. Very basic. Needs much more work later.

## [0.0.6] — 2026-10-02

**Scramble image, preferences and shortcuts dialog.**

- The scramble diagram at bottom-right.
- A preferences dialog with hold time and sound of inspection and app theme.
- A shortcuts dialog.

## [0.0.5] — 2026-10-02

**Statistics dialog, penalties and WCA inspection.**

- A stats dialog with ao5, ao12 and mo3, etc.
- Add +2 and DNF penalties and comments to solves. Modifiable through a dialog.
- WCA inspection: a 15-second countdown with 8 s and 12 s cues, `+2` at 15 s,
  `DNF` at 17 s, `Escape` to cancel.
- Each session remembers its scramble type; switching restores it.

## [0.0.4] — 2026-10-01

**Sessions.**

- Create, rename, switch and delete sessions.
- Each session owns its solve list, statistics and scramble type.

## [0.0.3] — 2026-10-01

**Solve recording and record list.**

- The solve list in the sidebar.
- A button to delete one or more solves, able to undo.

## [0.0.2] — 2026-10-01

**Add scrambles from csTimer through `cstimer_module`.**

- Scramble generation in a `worker_threads` worker so that it never blocks
  the UI. A 4x4 WCA scramble might take ~1 second so this is important.
- The next scramble is always prefetched, so it is on screen the instant
  a solve finishes.
- A two-level puzzle type selector over 206 puzzle types.

## [0.0.1] — 2026-09-30

**Scaffold and a hold-space timer.**

- GTK 4 + libadwaita through node-gtk, written in TypeScript.
- Hold Space and release to start, press to stop. Microsecond precision.

[Unreleased]: https://github.com/xlucn/puzzle-timer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/xlucn/puzzle-timer/tree/v0.1.0
[0.0.8]: https://github.com/xlucn/puzzle-timer/tree/v0.0.8
[0.0.7]: https://github.com/xlucn/puzzle-timer/tree/v0.0.7
[0.0.6]: https://github.com/xlucn/puzzle-timer/tree/v0.0.6
[0.0.5]: https://github.com/xlucn/puzzle-timer/tree/v0.0.5
[0.0.4]: https://github.com/xlucn/puzzle-timer/tree/v0.0.4
[0.0.3]: https://github.com/xlucn/puzzle-timer/tree/v0.0.3
[0.0.2]: https://github.com/xlucn/puzzle-timer/tree/v0.0.2
[0.0.1]: https://github.com/xlucn/puzzle-timer/tree/v0.0.1
