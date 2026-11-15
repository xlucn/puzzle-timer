# Building and running Puzzle Timer

Everything here assumes a source checkout. For what the app *is*, see the
[README](./README.md).

## Prerequisites

- **Rust 1.85 or newer** (the crate uses edition 2024).
- **GTK 4.24 or newer** and **libadwaita 1.9 or newer**, plus their development
  files. The scramble diagrams are drawn with GTK's own SVG renderer
  (`Gtk.Svg`), so librsvg is not needed.
- **JavaScriptCore 6**, the engine that runs the vendored scramble module. On
  most distributions it is part of the WebKit package.
- **pkg-config**, which the Rust bindings use to find the libraries above.
- **Meson 1.1 or newer** and **Ninja**, only to install the app; `cargo build`
  and `cargo run` do not need them.
- **blueprint-compiler**, which turns `src/ui/*.blp` into the `.ui` the build
  embeds; Cargo runs it, so a plain `cargo build` needs it too.
- **gettext** (`msgfmt`), which compiles the catalogs in `po/` into the `.mo`
  the app reads; Cargo runs it as well.

- **Arch:** `sudo pacman -S rust gtk4 libadwaita webkitgtk-6.0 pkgconf blueprint-compiler gettext`
- **Fedora:** `sudo dnf install rust cargo gtk4-devel libadwaita-devel javascriptcoregtk6.0-devel pkgconf-pkg-config blueprint-compiler gettext`
- **Debian/Ubuntu:** `sudo apt install rustc cargo libgtk-4-dev libadwaita-1-dev libjavascriptcoregtk-6.0-dev pkg-config blueprint-compiler gettext`

The distribution packages must be new enough to carry GTK 4.24, libadwaita 1.9
and JavaScriptCore 6. Older releases cannot build the app. It has only been
run on Linux.

## Build and run

```sh
cargo build              # debug build: target/debug/puzzle-timer
cargo run                # build and start it
cargo build --release    # optimised build: target/release/puzzle-timer
```

In a source checkout the app adds `data/icons` to the icon theme, so the
bundled symbolic icons appear without installing anything. A packaged build
picks them up from `/usr/share/icons` instead.

## Translations

The English strings in `src/locales/en.rs` are the message ids, and `po/` holds
one gettext catalog per language. `msgfmt` compiles them during `cargo build`,
and Meson installs the result under `$prefix/share/locale`.

To work on a translation, edit its `.po` (any gettext editor will do). To start
a new one:

```sh
msginit --locale=de --input=po/puzzle-timer.pot --output-file=po/de.po
# add `de` to po/LINGUAS
```

A new language is also a code change with visible strings of its own: a
`Language` variant in `src/core/i18n.rs`, its label in the preferences dialog,
and its entry in the language picker. `cargo test` fails when a catalog is
missing a string or a placeholder.

## Install with Meson

Meson puts the binary, the launcher entry and the icons where the session looks
for them; Cargo still compiles, and Meson only supplies the paths.

```sh
meson setup builddir --prefix=~/.local --buildtype=release
meson install -C builddir
```

`~/.local/bin` has to be in `PATH`; `~/.local/share` already is. Leave out
`--prefix` for the system default, or add `--destdir` to stage the files into a
package root instead of the running system. Without `--buildtype=release` you
get the debug profile, which is what a bare `meson setup builddir` builds.

The install step is the only one that needs Meson, and it runs
`cargo build --locked`, so `Cargo.lock` decides the dependency versions. The
verification probe (`scramble_sweep`) stays a `cargo` target.

### Uninstalling

```sh
ninja -C builddir uninstall
```

This reads the build directory's install log and deletes exactly the files the
install step wrote, so it must be the same build directory that installed them;
`meson compile` does not know the target, `ninja` does. The shared icon and
desktop-database caches stay behind — they belong to the whole system, not to
this app.

Your solves, sessions and preferences are in `~/.local/share/puzzle-timer`
(`$XDG_DATA_HOME/puzzle-timer`) and are left alone on purpose. Remove that
directory only when you want the data gone too.

## Tests and checks

```sh
cargo test                              # the pure core: no display needed
cargo fmt --all -- --check              # formatting
cargo clippy --all-targets -- -D warnings
```

`src/core/` is pure Rust, so the timer, statistics, sessions, layout and
scramble-feed tests need neither a display server nor the scramble engine.

The scramble boundary has its own health check:

```sh
cargo run --bin scramble_sweep          # every type through the real engine
```

It reports how many of the 206 scramble types it generated, how many images it
drew and how many failed; expect `OK=206 empty=0 images=177 failures=0`.
`--dump` prints only the scramble lines, which is how the engine's output is
compared against the Node reference (see [RUST-PORT.md](./RUST-PORT.md)).

## UI checks

Unit tests stop at the widget boundary. To drive the real window, run the app
on a nested X server and send it keys: [tools/README.md](./tools/README.md)
has the recipe, the scripts and the traps.

```sh
Xephyr :99 -screen 1280x800 -ac -br &
setsid bash -c 'DISPLAY=:99 GDK_BACKEND=x11 cargo run > /tmp/puzzle-timer.log 2>&1' &
DISPLAY=:99 python3 tools/xtest.py --window "Puzzle Timer" \
  tap ctrl+q sleep 0.5
```

Synthetic input on the live Wayland session needs a portal approval, so the
nested display is the supported way to script a run.

## How it works

The window is built with `gtk4-rs` and `libadwaita`; `src/main.rs` only starts
the application and loads the stylesheet. `style.css` is compiled into the
binary, so a stylesheet change needs a rebuild.

The scramble module is vendored as a JavaScript file and evaluated in
JavaScriptCore on a dedicated thread. The UI sends it plain requests and
receives plain results; a slow scramble therefore never blocks the window. The
engine sits behind a small trait in `src/scramble/`, so the V8 backend
described in [RUST-PORT.md](./RUST-PORT.md) can replace it without touching the
rest of the app.

Foreign libraries are found through `pkg-config` at build time and linked at
runtime. That is why a package has to depend on the WebKit/JavaScriptCore
library even though the executable itself is small.

## Learn more

- [gtk-rs](https://gtk-rs.org/) and [The gtk-rs book](https://gtk-rs.org/gtk4-rs/stable/latest/book/)
- [GTK 4 API reference](https://docs.gtk.org/gtk4/)
- [libadwaita API reference](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/)
- [Adwaita style classes](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/main/style-classes.html)
