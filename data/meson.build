# The launcher entry and the icon set. Both are picked up from `$datadir` at
# runtime, so a packaged build needs no code path of its own: `ui::load_css`
# adds the checkout's `data/icons` to the theme search path only when it is
# there.

install_data(
  'puzzle-timer.desktop',
  install_dir: datadir / 'applications',
)

install_subdir(
  'icons',
  install_dir: datadir,
)
