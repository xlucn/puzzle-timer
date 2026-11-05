# Puzzle Timer — project instructions

Native Linux cube timer (csTimer-like), built with GTK4 + libadwaita.

Docs: **[PLAN.md](./PLAN.md)** (plan, decisions, measurements — it is 140 KB:
`grep -n '^## '` and read one section, never the whole file) ·
**[DESIGN.md](./DESIGN.md)** (current architecture, distilled from PLAN.md) ·
**[CONTRIBUTING.md](./CONTRIBUTING.md)** (comment, prose and changelog policy;
it applies to agents too) · **[BUILD.md](./BUILD.md)** (build/run/test) ·
**[tools/README.md](./tools/README.md)** (UI harness, its traps, keyboard
recipes) · **[RUST-PORT.md](./RUST-PORT.md)** (research only, not scheduled).

## Invariants (cited by number — keep the numbering stable)

1. **`src/core/` is pure TypeScript** — no `gi:*`, no `node:fs`, `node:crypto`
   or `worker_threads`; it stays testable without a display server, and a
   runtime swap (e.g. to GJS) stays down to `ui/` + `platform/` + `scramble/`.
2. **Node-specific code lives in `src/platform/`** (`store.ts`, `random.ts`)
   and `src/scramble/` (worker host).
3. **Only `src/ui/` touches `gi:*`** (Gtk, Adw, GLib, Gio, Gdk, Gst).
4. **A scramble never generates on the main thread** — 4x4 takes ~1.2 s.
5. **Custom widget subclassing: probe before trusting.** Extending a JS
   wrapper (`class MyRow extends Adw.ActionRow` — no `registerClass`, no new
   GType; the native object stays stock) passed a full runtime probe (native
   props, `instanceof`, signal round-trip with a custom payload, 500-row
   churn, clean exit); `scrambleTypePicker.ts` uses it. A *new* GType
   (`registerClass`) is unproven: probe first, and record a failure here —
   fall back to maps/closures if it segfaults or a payload arrives as a bare
   wrapper.
6. **No Cairo text rendering** — node-gtk's toy text API is broken. Pango /
   `Gtk.Label`.

**Also before you start:**

- **The solve list is `Gtk.ColumnView`**, never `Gtk.ListBox`: a session can
  hold thousands of solves and ListBox builds every row.
- **No screenshots, no pixel judgments, unless the user asks** — they are
  slow and expensive and prove little here (see *Verification*).
- **One version, one place** — `package.json` via `src/platform/meta.ts`,
  never a literal in `main.ts`.
- **Never read a `.d.ts` whole** — `Gtk-4.0.d.ts` is 3.1 MB / 81k lines.
  `grep -n` the class or signal, then read ±30 lines around the match.

## Stack (decided — don't re-litigate unasked)

- **UI** node-gtk (GObject introspection) + GTK4 + libadwaita
- **Language** TypeScript via `tsx`; no build step in dev
- **Scrambles** `cstimer_module` in a `worker_threads` worker
- **Tests** Vitest, on `src/core/` and `src/platform/` only
- **Licence** GPL-3.0-or-later — mandatory: csTimer and `cstimer_module` are
  GPL-3.0
- Import namespaces with the `gi:` scheme: `import Adw from 'gi:Adw-1'`

## Layout and adaptation

- **Let adaptive widgets do their job — don't reimplement them.** Read the
  `.d.ts` class docs before writing layout or navigation code; putting an
  `Adw.NavigationSplitView` in the tree is not *using* it. Native pattern:
  `Adw.Breakpoint` drives `collapsed`; each `Adw.NavigationPage` carries its
  own `Adw.ToolbarView` + `Adw.HeaderBar`, so the split view supplies titles
  and the collapsed back button; the sidebar is a bare `Adw.Sidebar` with
  `Adw.SidebarSection`s; a dialog takes a default `contentWidth`/
  `contentHeight` and clamps itself. The manual version was ~600 lines and
  still looked wrong; the native one is ~300 and correct. If you find
  yourself writing what the widget documents, stop and delete it. The UI is
  native GTK4, not a copy of the csTimer webpage: prefer
  `Adw.OverlaySplitView`, `Adw.Dialog`, `Adw.PreferencesDialog`,
  `Adw.ToastOverlay`, `Adw.StatusPage`.
- **Sizes are one continuous function of the window; only structure is
  tiered.** `layoutFor()` (`src/core/layout.ts`) derives the readout, scramble
  text, scramble slot and diagram box from width and height (`readoutPx()`,
  the `SCRAMBLE` share, the `DIAGRAM`/`SCRAMBLE_SLOT` shares) — no size steps,
  no band edges. `BREAKPOINTS` holds only the two structural decisions
  (selectors' row ≤540, drawer ≤800) and `main.ts` builds exactly those.
  Never reintroduce a threshold whose only effect is a bigger number, and
  never put a size constant in `src/ui/` that the curve or a preference could
  disagree with — `src/ui/` applies only the numbers it is handed. The
  font-size preference rides an inline sheet (`src/ui/fontSize.ts`): GTK4 CSS
  has no custom properties, so install the new sheet before dropping the old.
- **Continuous sizes need a repaint hook, not a breakpoint.** `Gdk.Surface`'s
  `layout` signal (plus the after-paint pass) re-runs `applyLayout()` on every
  resize; a breakpoint fires only on a boundary crossing. The readout must
  read the **window**, never the measured content area, or Ctrl+B docking the
  sidebar would change the font size.
- **`Gtk.Overlay` children are not counted in the parent's size request**
  (measured). Overlay a spinner/status on the content it annotates
  (`scramblePanel.ts`), never stack it underneath. The diagram's box is pinned
  the same way: a spacer carries the cap as a size request and the
  `Gtk.Picture` rides in the overlay, so the SVG is parsed once and a resize
  re-parses nothing.
- **A `Gtk.Svg` paintable reports whole-px intrinsic size** — floored, ceiled
  or rounded, not the declared root size. csTimer declares 74 of its 177
  images with a fractional dimension (4x4 is 526×392.667), so a parse check
  must accept floor/ceil/round; an exact comparison silently hides every
  4x4–7x7, megaminx, pyraminx and square-1 diagram.
- **The type picker rebuilds its list, it does not filter it.** One render
  path keyed on `browse`: rebuilding the ~19 visible rows costs ≈3 ms, while
  `Gtk.ListBox.setFilterFunc` over all 206 rows costs ≈79 ms *per change*
  (≈0.4 ms/row-crossing through node-gtk). The 44 categories are four
  `Adw.SidebarSection`s; item indices stay flat across sections. A dialog
  using an `Adw.Breakpoint` needs an explicit `width-request`/`height-request`
  or it logs "does not have a minimum size". CSS: the sidebar's `ListBox`
  gets `navigation-sidebar`, and neither `ScrolledWindow` carries `view` —
  `.view` paints an opaque `@view_bg_color` over the split view's muted pane
  and the rail reads as a white box; the content list gets 12 px margins so
  its card frame floats inside the pane.

## Input

- **Every action needs a touch path, and touch must not become a second input
  model** (PLAN.md decision 15). Gestures call the same entry points the
  keyboard does (`timer.keyDown('space', …)`, the same `remove()` → toast →
  `restore()`), so there is one state machine, one deletion path, one undo.
  Before shipping an action, check it is reachable with no modifier and no
  accelerator — Shift/Ctrl-click and Escape are what a phone does not have.
  Multi-select is the deliberate exception: GTK's Ctrl/Shift-click only,
  every action on a single solve still touchable.
- **The start area is a target, not a gesture race.** A transparent overlay
  child of `lowerArea` carries the timer gesture. While the list is a drawer
  (`split.collapsed`) it is inset by `START_AREA_INSET_PX` (16 px) on the
  left, right and bottom (the top stays flush with the scramble) and draws a
  dashed `.timer-start-area` outline; wide windows have no edge swipe and
  the distraction-free view wants the whole area, so both drop the inset and
  the outline (`syncStartArea()`, called from `applyLayout` and
  `applyTimerLayout`). libadwaita's swipe strip is 32 px, so its outer half
  belongs to the drawer and the card covers the inner half: a press inside
  the card claims the sequence, no swipe can start there, and no edge
  predicate, `stopped`/cancel listener or frame check is needed. Never
  connect `cancel`/`unpaired-release`: they carry a boxed `GdkEventSequence`
  that crashes node-gtk on ARM.
  A collapsed `Adw.OverlaySplitView` with
  `show-sidebar=false` can keep its input shield child-visible (`show-progress`
  stays 1) and swallow the content's press. The shield is the `AdwGizmo` named
  `widget` — not the shadow helper's `dimming`/`shadow`/`border`/`outline`
  gizmos, which already have `can-target` false — and it is silenced with
  `can-target`, never `visible`: hiding it leaves it needing an allocation and
  GTK warns "without a current allocation" while snapshotting.

## API traps

- **node-gtk signal handlers** take exactly the signal's parameters — no
  emitter first — and the return value becomes the signal's return value:
  that is how a `boolean` `key-pressed` reports "handled", so return `false`
  to keep propagating. Verified against `node-gtk/src/closure.cc`; look the
  `.on(...)` overload up in `node_modules/.node-gtk-types/` (grep only).
- **Not all Adw/Gtk properties are plain text.** `AdwActionRow:title` parses
  markup — hence `useMarkup: false` in the type picker
  (`3x3x3 Roux - LSE <M, U>`). `AdwAboutDialog:release-notes` parses an
  **AppStream description**: only `<p>`, `<ul>`/`<ol>` with `<li>`, `<em>` and
  `<code>`; an unknown element aborts the whole dialog
  (`Unexpected element 'b'`), there is no bold, and text outside a paragraph
  or list item is dropped. Escape user data, or set `useMarkup: false`.
- **Accelerator key names are case-sensitive gdk_keyval names** — `'space'`,
  not `'Space'`. A typo fails silently: the chip renders empty in
  `Adw.ShortcutsDialog` and nothing says why. Check every new entry with
  `Gtk.acceleratorParse`.
- **`gi:*` shims export values only**, so `Gtk.Widget` is not a type
  annotation. Let TypeScript infer widget types (`createTimerView()`).

## Release and docs

- **Six relative paths are load-bearing for the packaged layout**:
  `styles.addFile('../style.css')` (`src/main.ts`); `Gtk.IconTheme
  .addSearchPath('../data/icons')` — the path holds *theme directories*, so it
  is the **parent** of `hicolor`; the `.ts`/`.js` worker branch
  (`src/scramble/service.ts`); `meta.ts`'s `../../package.json` **and**
  `../../CHANGELOG.md` (the About dialog parses release notes from it); and
  bare `node-gtk/register`, which resolves from the **cwd**, so the `/usr/bin`
  launcher must `cd` first. `src/` and `dist/` are siblings by design, so one
  path serves both — moving either breaks all six. `tools/icon_probe.mjs`
  checks the icon path headlessly.
- **Probe scripts use app ids under
  `io.github.xlucn.PuzzleTimer.probe.<name>`** — never a personal
  (`com.oliver.*`) or stale project (`org.cstimer.gtk.*`) one. The id only has
  to be valid and distinct from the app's, but it is the one place in `tools/`
  where the author's name used to leak into a released tree.
- **Statistics may be ported from csTimer's GPL source** (`cs0x7f/cstimer`):
  port the math, not the DOM — ao5/ao12/mo3 trimming, DNF-as-∞, penalties, and
  the same rule for csTimer's data-file format and chart math (PLAN.md §5).
  Attribute csTimer and `cstimer_module` in the About dialog.
- **No bare user-visible literals.** Every label, tooltip, menu entry, toast
  and dialog text in `src/ui/` and `src/main.ts` goes through `t()` from
  `src/core/i18n.ts`. Catalogs are TS modules: `src/locales/en.ts` is the
  source of truth and every other locale is `Record<keyof typeof en, Message>`,
  so a missing key is a compile error, never a raw key on screen. Scramble
  group and section names are translated; the ~209 type names stay English.
  Times stay in `formatTime`; the narrow list/edit timestamps stay numeric —
  `Intl.DateTimeFormat` is for dates with room around them. `main.ts` resolves
  the `language` preference once, before any widget is built; a change needs a
  restart.
- **The About dialog** is `Adw.AboutDialog` (`Adw.AboutWindow` is
  deprecated); its licence enum is `Gtk.License.GPL_3_0`, which means *3.0 or
  later* and matches `package.json`'s `GPL-3.0-or-later` (`GPL_3_0_ONLY` does
  not).
- **Say plainly that AI/LLM assistance was used, and say it early.** The
  README's *AI disclosure* section sits above Features and Install, says who
  did what, with which tools and how the work was directed; the About dialog's
  `comments` is the one-line version. They are not verbatim twins — reword one
  for a new fact and check the other still agrees.
- **The licence is stated in four places and they must agree**: `LICENSE`,
  `package.json`'s `"license"`, the README's `## License`, the About dialog.
  Dropping one is how a release ships without a licence.
- **Comments are for peer developers, not a diary**
  ([CONTRIBUTING.md](./CONTRIBUTING.md) has the policy): present tense, only
  what the code cannot say — the *why*, a constraint, a one-line gotcha.
  Never narrate position or wiring, and never write dates, "(user call, …)",
  milestone tags or "used to be" stories: that is git's job.
- **User-visible prose is written by hand** — scope and tells in
  [CONTRIBUTING.md](./CONTRIBUTING.md). An agent drafts it into the file and
  stops: the change stays **uncommitted** until a person has edited and
  approved it. Only a typo, a wrong number or a stale fact may be fixed
  directly. Governed: README, CHANGELOG, CONTRIBUTING, BUILD, DESIGN and the
  in-app strings; exempt as working documents: PLAN.md, AGENTS.md,
  RUST-PORT.md. The docs speak in the author's first person, a claim earns a
  concrete example, a feature bullet says what the user gets, and an
  unfinished area is marked ("Currently …"). `3x3`, not `3×3`, outside the UI.
- **CHANGELOG entries say what the user gets, not what was built.** The
  summary names the release in plain words, carries no milestone number, and
  may speak in the first person. Bullets are one clause each, in the user's
  language: no rationale, no widget names or internal identifiers, no
  measurements, no bold, no tooling work. Admit what is still broken.
  `### Project` holds research and process.

## Commands

- `npm run dev` (CSS hot-reload) / `npm start` —
  `node --import tsx --import node-gtk/register src/main.ts`
- `npm run typecheck` after any TS change; `npm test` — Vitest over
  `src/core/` and `src/platform/` (timer, stats, sessions, layout, scramble
  feed, store, meta). `dist/` is excluded: it holds stale compiled tests.
- `node --import tsx tools/scramble_probe.ts --quiet` — all 206 types through
  the real worker, headless; expect `206/206 types generated`.
- `node --import tsx --import node-gtk/register tools/prefs_probe.mjs` — the
  real Preferences dialog headless; expect `ALL PASS`. `node-gtk/register` is
  mandatory: bare `--import tsx` dies with `ERR_UNSUPPORTED_ESM_URL_SCHEME` on
  `gi:`.
- `… tools/breakpoint_probe.mjs` — adaptive plumbing on a nested display; its
  bands come from `core/layout.ts` and its widest step is 900 px, so
  `1280x800` is enough.
- `… tools/icon_probe.mjs` — both icon names resolve through the theme;
  `ALL PASS`.
- **Fresh install**: if `npm install` dies in `postinstall` with
  `MODULE_NOT_FOUND .../node-gtk/lib/native.js`, npm blocked the install
  scripts — the fix is in [BUILD.md](./BUILD.md) → Fresh install. Re-approve
  after bumping either dependency; the allowlist is version-pinned.

## Verification (manual; never part of `npm test`)

- **Verify structure and state, not pixels.** Typecheck, `npm test`, a
  widget-tree or `stderr` dump; then hand the user a short **checkpoint list**
  to confirm visually. Capture only when asked, and never judge a repaint from
  one frame: `XGetImage` on XWayland returns stale frames that look frozen.
- **Drive the app on a nested display** —
  `Xephyr :99 -screen 1280x800 -ac -br`, everything prefixed `DISPLAY=:99`.
  Synthetic XTEST on the live Wayland session summons GNOME's RemoteDesktop
  consent even for a key tap, and the unanswered prompt steals focus mid-run.
- **Start it detached from the tool call**:
  `setsid bash -c 'DISPLAY=:99 GDK_BACKEND=x11 npm start > LOG 2>&1' &`. A
  `(npm start … &)` dies with the call's process group — no log, no core, no
  journal entry, which reads exactly like a crash. Suspect this before an app
  bug; only a death *inside* a call counts as one.
- **Drive by keys, not clicks.** Every action under test gets an accelerator
  first — `app.setAccelsForAction(...)` in `src/main.ts` plus an entry in
  `src/ui/shortcuts.ts`. Clicks need portal approval, fight the physical
  mouse, and menus photograph black. Pointer gestures are still drivable with
  XTEST (`down`/`sleep`/`up`/`drag` in `tools/xtest.py`); a press on the
  timer area is the start key once **Mouse control** is on in Preferences (off
  by default, the gesture is `touchOnly` until then).
- **Stop the app when the run ends**: `pkill -f 'src/main[.]ts'`, and stop
  Xephyr too if you started it. A pattern like `main[.]ts` cannot match the
  pkill's own command line; an unbracketed one kills the shell instead.
- **A frozen-looking run is usually a stale capture, not a wedged app**:
  restart once, re-drive the step, and believe the log. Do not loop on
  retries — if it still looks wrong, ask the user.
- **Hand interactive testing over early**: if synthetic input keeps landing
  off-window or racing the user's mouse, switch to keys, or ask the user to
  click and watch.
- Focus anchors, the keyboard walk and every trap:
  [tools/README.md](./tools/README.md).

## Out of scope (agreed, do not add unprompted)

Bluetooth smart cubes, virtual cube, solvers, and packaging **beyond the AUR
package scheduled as M16**. Stackmat is a **long-term** goal (PLAN.md), not
current work.

**Scheduled — not out of scope** (PLAN.md §1; follow the milestone blocks,
don't redesign them): **M10** csTimer import/export → **M11** records &
statistics → **M12** charts → **M16** AUR package (one blocker left: the repo
must be public at tag time; PLAN.md §6 has the draft PKGBUILD). Numbers are
stable identifiers, not queue positions: reorder the queue, never the
numbers. M7, M15, M8 and M9 landed; their blocks stay in PLAN.md §6.

Only **M15** may reopen packaging any further (Flatpak, deb, AppStream).

**Rust port: researched, not scheduled.** [RUST-PORT.md](./RUST-PORT.md) holds
the evidence (six JS engines reproduce Node's 206 scrambles byte-for-byte, so
the module can be *embedded* rather than ported); `tools/rust-embed/run.sh`
re-runs it. Do not start a port without being asked — it is not a milestone.
