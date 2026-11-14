# Puzzle Timer — project instructions

Native Linux cube timer (csTimer-like), built with GTK4 + libadwaita.

**`main` is the Rust port (M18, since 2026-11-10).** The v0.3.0
TypeScript/node-gtk app is frozen on branch `legacy`; its own `AGENTS.md`,
`DESIGN.md`, `BUILD.md`, npm commands and headless probes live there. This
file governs `main` only. Do not reintroduce Node or `node-gtk` on `main`.

Docs: **[PLAN.md](./PLAN.md)** (plan, decisions, measurements — it is large:
`grep -n '^## '` and read one section, never the whole file) ·
**[RUST-PORT.md](./RUST-PORT.md)** (engine evidence and the port surface) ·
**[CHANGELOG.md](./CHANGELOG.md)** · **[CONTRIBUTING.md](./CONTRIBUTING.md)**
(comment, prose and changelog policy; it applies to agents too) ·
`BUILD.md`, `DESIGN.md` and `README.md` still describe v0.3.0 and need a
hand-written update at the cutover — don't rewrite them unprompted.

## Invariants (cited by number — keep the numbering stable)

1. **`src/core/` is pure Rust** — no `gtk4`, `libadwaita`, JSC, filesystem,
   network or threads. It stays testable headlessly with `cargo test`, and the
   UI can be rebuilt without touching the maths.
2. **OS and IO live in `src/platform/`** (store, random, audio, meta) and in
   `src/scramble/` (the JSC host). Nothing else opens a file or spawns a
   process.
3. **Only `src/ui/` touches `gtk4` / `libadwaita`.** Widgets talk to `core`
   through plain data and callbacks.
4. **A scramble never runs on the main thread**, and **one thread owns the
   JSC context** (JSC contexts are not `Send`/`Sync`). Results come back
   through a channel plus `glib::idle_add`/`MainContext`, never by evaluating
   JS from a second thread.
5. **Embed `cstimer_module`; never port it.** Vendor the 0.1.5 bundle and
   evaluate it in JavaScriptCore. Seed parity is a contract: the same seed and
   the same call order must produce the same 206 scrambles as the Node
   reference (RUST-PORT.md §2).
6. **Data compatibility is not optional.** The Rust app uses the same XDG
   paths, JSON schema, atomic-write, quarantine and undo rules as v0.3.0. A
   user upgrading from `0.3.0` must keep every solve.
7. **i18n is typed catalogs, not gettext.** `en` is the source of truth and
   every other locale must be exhaustive, so a missing key is a compile
   error, never a raw key on screen. No bare user-visible literals.
8. **One version, one place**: `Cargo.toml` via
   `env!("CARGO_PKG_VERSION")`; the About dialog parses its release notes from
   `CHANGELOG.md`.
9. **Native adaptive widgets do the work — don't reimplement them.**
   `Adw.OverlaySplitView`, `Adw.Dialog`, `Adw.PreferencesDialog`,
   `Adw.ToastOverlay`, `Adw.StatusPage`, `Adw.ViewSwitcher` +
   `Adw.ViewSwitcherBar`, `Adw.Breakpoint`. Sizes are one continuous function
   of the window; only structure is tiered.
10. **M18 is parity work.** No new features until the port exits; a missing
    feature is a porting bug, not a redesign.

## Stack (decided — don't re-litigate unasked)

- **UI** `gtk4` 0.11.5, feature `v4_24`, plus `libadwaita` 0.9.2, feature
  `v1_9`. The crate import names in these versions are **`gtk4`** and
  **`libadwaita`** (not `gtk`/`adw`). `v1_10` is *not* a feature of
  libadwaita-rs 0.9.2; the app uses no 1.10-only accessor (`Adw.Sidebar` is
  1.9).
- **Scramble engine** JavaScriptCore 6 (`javascriptcoregtk-6.0`), through the
  eight-function FFI proven in `tools/rust-embed/probe-jsc`. **JSC is the
  default for binary size**; **V8** (the `v8` crate) is the alternative when a
  self-contained engine is preferable to the system WebKit dependency. Both
  live behind `src/scramble/`'s `ScrambleEngine`; `core/` and `ui/` never see
  an engine. The packaging dependency is `webkitgtk-6.0`
  (`libjavascriptcoregtk-6.0`).
- **Module** vendored `cstimer_module` 0.1.5 (`vendor/cstimer_module.js`),
  GPL-3.0, evaluated with the host shim in `src/scramble/`.
- **Core** pure Rust; `cargo test`.
- **Persistence/JSON** `serde_json`; **CSPRNG** `getrandom` or
  `/dev/urandom`.
- **Charts** `gtk4::DrawingArea` + `cairo`; no Cairo text (Pango/`Gtk.Label`).
- **Audio** spawn the same `pw-play` → `paplay` → gst → `aplay` fallback.
- **Licence** GPL-3.0-or-later — mandatory: csTimer and `cstimer_module` are
  GPL-3.0.

## Layout

```
src/
├── main.rs              bootstrap: Adw.Application, window, actions, layout
├── core/                ★ pure Rust — the v0.3.0 core modules, ported
├── scramble/            vendored bundle, JSC context, worker, protocol
├── platform/            store, random, audio, meta (OS/IO only)
├── ui/                  GTK widgets; the only place that imports gtk4/libadwaita
└── locales/             typed en + zh-CN catalogs
```

- **Port order is in PLAN §6 M18.** Keep the tree compiling and tested while
  moving one module at a time; port each module's tests with it.
- **The scramble boundary stays thin**: request/response as plain data, one
  thread owning the context, the UI seeing an async callback.
- **`Gtk.ColumnView`, not `Gtk.ListBox`** for the solve list: a session can
  hold thousands of solves. The model is a list of solve ids; cells read their
  text in `bind`, so delete/undo can never point at the wrong row.
- **Sizes are continuous.** Keep the `core/layout` formulas and apply them
  from `Gdk.Surface::layout` plus the after-paint pass; a breakpoint fires
  only at a structural boundary. The readout reads the **window**, never the
  measured content area, or docking the sidebar changes the font.
- **Bundle extra symbolic icons under `data/icons/hicolor/scalable/actions/`.**
  hicolor's index has no `symbolic/actions` directory; only `symbolic/apps` is
  listed (the app icon lives there). "Scalable" is about resolution, not
  colour — a `*-symbolic.svg` is still recoloured by GTK.
- **GTK CSS has no custom properties.** Install a new provider before dropping
  the old one when a preference changes the sheet.
- **A `Gtk.Overlay` child is not counted in the parent's size request.**
  Overlay a spinner/status on the content it annotates; pin a picture's cap
  with a spacer.

## Scramble engine

- **JSC is the default; V8 is the alternative.** Keep the choice inside
  `src/scramble/` (`ScrambleEngine` + `DefaultEngine`), never in `core/` or
  `ui/`. JSC's win is the small executable — measured 2,758,944 B release,
  1,982,432 B stripped, with the engine in the system library. V8's win is
  independence from `webkitgtk-6.0`.
- The bundle is Closure-compiled ES5 and needs the Node-ish shim documented in
  RUST-PORT.md §3: `global`, `process`, `require`, `module`, `console`, plus
  `SCRAMBLE_NOOBST`/`SCRAMBLE_NOOBSS` (not in the bundle) and boa's `substr`
  fallback.
- Seed once when the context is created; call `setGlobal('preScr', …)` before
  a scramble when the preference asks for it; call `getImage` in the same
  round trip as `getScramble`.
- `getImage` answers **`false`** for the 29 types with no drawing rule — bind
  it as a truthy string / optional string, never as a missing value that
  fails the scramble.
- The full 206-type sweep is the health check. Don't run two slow engines
  concurrently; they contend.

## i18n

- Catalogs are Rust modules with an exhaustive key set; `en` is the source of
  truth. Port the v0.3.0 keys and placeholders, not new wording.
- `Adw.AboutDialog` release notes are an **AppStream description**: only
  `<p>`, `<ul>`/`<ol>` with `<li>`, `<em>`, `<code>`; an unknown element aborts
  the dialog. Escape user data.
- `Adw.ActionRow:title` parses markup — use `use_markup(false)` for type names
  like `3x3x3 Roux - LSE <M, U>`.
- Scramble group/section names are translated; the ~209 type names stay
  English. Times stay in the core formatter; dates use the locale-aware
  formatter with room around them.

## Release and docs

- **User-visible prose is written by hand.** An agent drafts README,
  CHANGELOG, CONTRIBUTING, BUILD, DESIGN and in-app strings into the file and
  stops: the change stays **uncommitted** until a person has edited and
  approved it. Only a typo, a wrong number or a stale fact may be fixed
  directly. PLAN.md, AGENTS.md and RUST-PORT.md are exempt working documents.
- **CHANGELOG entries say what the user gets**, one clause each, no widget
  names, no measurements, no bold; admit what is still broken. `### Project`
  holds research and process.
- **The licence is stated in four places and they must agree**: `LICENSE`,
  the package metadata (now `Cargo.toml`), the README's `## License`, the
  About dialog. The About enum is `Gtk.License::Gpl30` (*3.0 or later*).
- **Say early that AI/LLM assistance was used**, in the README and in one line
  in the About `comments`.
- **Tags:** cut a stage only when the user calls it:
  bump `Cargo.toml` → cut the changelog → commit → `git tag -a vX.Y.Z -m …` →
  `git push --follow-tags`. Milestone numbers never enter a version.
- **M16/M17** package the Rust binary; README/BUILD/AppStream work in those
  blocks is hand-written prose, not generated.

## Commands

- `cargo test` — unit/integration tests, no display needed for `core/`.
- `cargo run` — the app.
- `cargo build --release` — the package binary.
- `cargo fmt` and `cargo clippy --all-targets -- -D warnings` after a change.
- `cargo run --bin scramble_sweep` — all 206 types through the real JSC
  bridge; expect `206/206` and 177 images.
- `tools/rust-embed/run.sh` — the engine research harness (Node, deno, V8,
  JSC, optionally QuickJS/boa/libnode). It is a probe, not a dependency.
- Node/npm commands belong to the `legacy` branch only; don't add them back.

## Verification (manual; never part of `cargo test`)

- **Verify structure and state, not pixels.** `cargo clippy`, `cargo test`, a
  widget-tree or `stderr` dump; then hand the user a short **checkpoint list**
  to confirm visually. Capture only when asked.
- **Drive the app on a nested display** — `Xephyr :99 -screen 1280x800 -ac
  -br`, everything prefixed `DISPLAY=:99`. Synthetic XTEST on the live Wayland
  session summons a consent prompt; start the app detached from the tool call:
  `setsid bash -c 'DISPLAY=:99 GDK_BACKEND=x11 cargo run > LOG 2>&1' &`.
- **Drive by keys, not clicks.** Every action under test gets an accelerator
  first. Pointer gestures are possible with `tools/xtest.py`, but clicks need
  portal approval and fight the user's mouse.
- **Stop the app when the run ends**: `pkill -f 'target/debug/puzzle-timer'`
  (bracket a character if the pattern would match the pkill's own command
  line), and stop Xephyr too. A frozen-looking run is usually a stale capture:
  restart once, believe the log, don't loop.
- **No screenshots or pixel judgments** unless the user asks.

## Out of scope (agreed, do not add unprompted)

Bluetooth smart cubes, virtual cube, solvers, and packaging beyond **M16**
(AUR) and **M17** (postmarketOS/Alpine). Stackmat is a long-term goal
(PLAN.md), not current work. **M19 (Vala)** is a comparison the user asked
for after Rust ships — don't start it early. Flatpak/deb/AppStream remain
closed.
