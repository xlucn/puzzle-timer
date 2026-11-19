# Cargo does the compiling; Meson supplies the paths and the install step, so
# dependencies, features and the profile keep living in `Cargo.toml`.
#
# `--bin` keeps the verification probe (`scramble_sweep`) out of a package
# build; it is still built by `cargo run --bin scramble_sweep`.

cargo = find_program('cargo')
sh = find_program('sh')

cargo_options = [
  'build',
  '--locked',
  '--bin', meson.project_name(),
  '--manifest-path', meson.project_source_root() / 'Cargo.toml',
  '--target-dir', meson.project_build_root() / 'target',
]

# Cargo has no `debugoptimized`, and its debug profile is what a plain
# `meson setup` should produce.
rust_dir = 'debug'
if get_option('buildtype') == 'release'
  cargo_options += '--release'
  rust_dir = 'release'
endif

built_binary = meson.project_build_root() / 'target' / rust_dir / meson.project_name()

# Meson runs a build rule through the shell, so cargo's output can be moved to
# the name Meson installs. Single-quoting survives a source path with spaces.
quoted = []
foreach arg : [cargo.full_path()] + cargo_options
  quoted += '\'' + arg + '\''
endforeach

# `platform::i18n` bakes this in, so the binary Meson installs reads the
# catalogs from the prefix it was built for; a `cargo run` build reads them
# from OUT_DIR instead.
quoted = ['PUZZLE_TIMER_LOCALEDIR=\'' + catalogdir + '\''] + quoted

custom_target(
  'cargo-build',
  build_by_default: true,
  build_always_stale: true,
  output: meson.project_name(),
  console: true,
  install: true,
  install_dir: bindir,
  command: [
    sh,
    '-c',
    '@0@ && cp @1@ @OUTPUT@'.format(' '.join(quoted), built_binary),
  ],
)
