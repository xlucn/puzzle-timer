# The launcher entry and the icon set. Both are picked up from `$datadir` at
# runtime, so a packaged build needs no code path of its own: `ui::load_css`
# adds the checkout's `data/icons` to the theme search path in debug builds.
#
# The entry and the icon are both named after the application id: the entry
# because that is what a window exports (`_GTK_APPLICATION_ID` on X11, the
# xdg-toplevel app id on Wayland) and how the shell pairs it with a launcher,
# the icon because `Icon=` names it and because a Flatpak exports an
# application's icon out of `/app/share/icons` only under that name.

install_data(
  'io.github.xlucn.PuzzleTimer.desktop',
  install_dir: datadir / 'applications',
)

# The AppStream entry: what a software centre and `flatpak` read for the name,
# the summary, the developer and the version — without it a Flatpak shows up
# as an unknown app in Flatseal and in the store.
install_data(
  'io.github.xlucn.PuzzleTimer.metainfo.xml',
  install_dir: datadir / 'metainfo',
)

install_subdir(
  'icons',
  install_dir: datadir,
)
