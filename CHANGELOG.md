# Changelog

Notable changes to this project, most recent first.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

This release focuses on packaging. The app is now packaged in [AUR].
Github Actions publishes a nightly build on every push to `main`.

### Added

- Meson build system.
- Flatpak manifest files.

### Fixed

- Keep touch screen support when mouse control is disabled.
- The app icon now shows correctly.
- Cancel button in the inspection now works properly.

### Changed

- Using po files for translations instead of in rust code.

## [0.4.0] — 2026-11-14

This release is dedicated to porting the programming language to Rust. The UI,
features and data compatibility are kept the same. No new features.

The TypeScript version is frozen on branch `legacy`.

## [0.3.0] — 2026-11-10

This release adds scramble options, language support, data import and export, more statistics, and a session manager.

### Added

- A dropdown arrow on the scramble type button to change options related to the current scramble type if available.
- A fast 4x4 option (only as scramble option for WCA 4x4x4 type) that use random moves instead of random state for faster scramble generation.
- A pre-scramble setting that turns the scramble diagram to a certain orientation.
- Language support, currently English and Simplified Chinese.
- Import from and export to data files, aiming to be compatible with csTimer.net.
- A session manager to rename, delete and reorder sessions, opened from the sidebar header.
- Statistics improvements: averages, PB, activities, streaks, charts and histograms.

## [0.2.1] — 2026-11-03

This release is mainly about improving existing features.

### Added

- Size scaling settings for the timer, the scramble text and the scramble diagram.
- A button in the sidebar header to create a new session, instead of an item in session drop-down menu.
- A fullscreen toggle in the menu.

### Changed

- The timer, the scramble text and the diagram now grow continuously with the window instead of in discrete steps.
- Touching or clicking on the scramble text no longer start the timer; only the timer area is recognized.
- The app menu is moved to the main header bar, and the session switcher is now in the sidebar's header.
- The solve editor UI adjusted to have a Cancel button and a Save button.
- The inspection audio cues are now disabled by default.

### Fixed

- Multiple finger touch on the timer didn't trigger the timer start.

## [0.2.0] — 2026-10-27

Mainly added touch support and distraction-free mode.

### Added

- Support starting and stopping the timer by mouse or touch.
- Added a cancel button during inspection.
- Distraction free during inspection and solve: hide everything except the timer.

### Changed

- Starting an inspection no longer needs holding.

### Fixed

- The scramble diagram no longer covers the timer.
- The timer layout no longer jumps back and forth at the threshold of the sidebar toggle.

## [0.1.0] — 2026-10-22

First release ready for public use.

### Added

- The icon is updated, and there is a symbolic variant for small sizes.
- A desktop entry.

### Changed

- The app name changed to Puzzle Timer.

## [0.0.8] — 2026-10-16

This release mainly contains improvements to features in previous releases.

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
  buttons. It triggers a pop-up dialog.
- The puzzle category and type are shown as the window's title and subtitle.
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
- The sidebar does not expand over 320 px now, no need for that much space.

### Fixed

- The Statistics table now adapts to a narrow window for phone form factor.

## [0.0.7] — 2026-10-02

Implemented adaptive layout.

- The solve list becomes a drawer for narrow window.
- The header adapts instead of truncating.
- Phone form factor considerations. Very basic. Needs much more work later.

## [0.0.6] — 2026-10-02

Scramble image, preferences and shortcuts dialog.

- The scramble diagram at bottom-right.
- A preferences dialog with hold time, sound of inspection cues and app theme.
- A shortcuts dialog.

## [0.0.5] — 2026-10-02

Statistics dialog, penalties and WCA inspection.

- A stats dialog with ao5, ao12 and mo3, etc.
- Add +2 and DNF penalties and comments to solves. Modifiable through a dialog.
- WCA inspection: a 15-second countdown with 8 s and 12 s cues, `+2` at 15 s,
  `DNF` at 17 s, `Escape` to cancel.
- Each session remembers its scramble type.

## [0.0.4] — 2026-10-01

Added sessions.

- Create, rename, switch and delete sessions.
- Each session has its own solve list, statistics and scramble type.

## [0.0.3] — 2026-10-01

Solve recording and record list.

- The solve list in the sidebar.
- A button to delete one or more solves, able to undo.

## [0.0.2] — 2026-10-01

Add scrambles from csTimer through `cstimer_module`.

- Scramble generation.
- Prefetch the next scramble for better performance.
- A two-level puzzle type selector.

## [0.0.1] — 2026-09-30

Scaffold and a basic timer.

- GTK 4 + libadwaita through node-gtk, written in TypeScript.
- Basic timer. Hold Space and release to start, press to stop.

[AUR]: https://aur.archlinux.org/packages/puzzle-timer-git
[Unreleased]: https://github.com/xlucn/puzzle-timer/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/xlucn/puzzle-timer/tree/v0.4.0
[0.3.0]: https://github.com/xlucn/puzzle-timer/tree/v0.3.0
[0.2.1]: https://github.com/xlucn/puzzle-timer/tree/v0.2.1
[0.2.0]: https://github.com/xlucn/puzzle-timer/tree/v0.2.0
[0.1.0]: https://github.com/xlucn/puzzle-timer/tree/v0.1.0
[0.0.8]: https://github.com/xlucn/puzzle-timer/tree/v0.0.8
[0.0.7]: https://github.com/xlucn/puzzle-timer/tree/v0.0.7
[0.0.6]: https://github.com/xlucn/puzzle-timer/tree/v0.0.6
[0.0.5]: https://github.com/xlucn/puzzle-timer/tree/v0.0.5
[0.0.4]: https://github.com/xlucn/puzzle-timer/tree/v0.0.4
[0.0.3]: https://github.com/xlucn/puzzle-timer/tree/v0.0.3
[0.0.2]: https://github.com/xlucn/puzzle-timer/tree/v0.0.2
[0.0.1]: https://github.com/xlucn/puzzle-timer/tree/v0.0.1
