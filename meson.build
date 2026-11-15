# Meson drives installation; Cargo still does the compiling.
#
# `meson setup builddir --prefix=~/.local && meson install -C builddir` puts
# the binary, the desktop file and the icons where a session looks for them,
# which is what a package needs. Plain `cargo build`/`cargo run` keep working
# from a checkout, and Cargo remains the only source of dependencies and of
# the version: `project()` cannot run a command before it is called, so the
# version is deliberately absent here rather than written twice (see
# `platform::meta::APP_VERSION`, which reads `Cargo.toml`).

project(
  'puzzle-timer',
  'rust',
  meson_version: '>= 1.1',
  license: 'GPL-3.0-or-later',
)

gnome = import('gnome')

bindir = get_option('prefix') / get_option('bindir')
datadir = get_option('prefix') / get_option('datadir')
localedir = get_option('prefix') / get_option('localedir')

subdir('data')
subdir('po')
subdir('src')

# The icon cache and the desktop database are what make the launcher entry and
# the app icon appear without a logout.
gnome.post_install(
  gtk_update_icon_cache: true,
  update_desktop_database: true,
)
