# The catalogs. `msgfmt` compiles each `po/*.po` into the install directory, so
# no generated `.mo` is kept in the tree; `build.rs` runs the same compile into
# OUT_DIR for `cargo run`.

fs = import('fs')
msgfmt = find_program('msgfmt')

# One language per line, `#` for comments — the same file `build.rs` reads.
linguas = []
foreach line : fs.read('LINGUAS').split('\n')
  language = line.strip()
  if language != '' and not language.startswith('#')
    linguas += language
  endif
endforeach

foreach language : linguas
  custom_target(
    'mo-' + language,
    input: language + '.po',
    output: 'puzzle-timer.mo',
    command: [msgfmt, '--check', '--output-file', '@OUTPUT@', '@INPUT@'],
    build_by_default: true,
    install: true,
    install_dir: catalogdir / language / 'LC_MESSAGES',
  )
endforeach
