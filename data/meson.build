# The launcher entry and the icon set. Both are picked up from `$datadir` at
# runtime, so a packaged build needs no code path of its own: `ui::load_css`
# adds the checkout's `data/icons` to the theme search path in debug builds.
#
# The entry is named after the application id, because that is what a window
# exports (`_GTK_APPLICATION_ID` on X11, the xdg-toplevel app id on Wayland)
# and how the shell pairs it with a launcher; the icon keeps the shorter name
# in `Icon=`.

install_data(
  'io.github.xlucn.PuzzleTimer.desktop',
  install_dir: datadir / 'applications',
)

install_subdir(
  'icons',
  install_dir: datadir,
)
