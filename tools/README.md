# tools/ — manual UI verification

Helpers for driving the running app with synthetic keyboard input and
photographing it, so UI behaviour can be checked without a human at the
keyboard. **These are not part of `npm test`** — unit tests cover `src/core/`;
these cover the part Vitest cannot, which is the GTK layer.

| File | What it does |
|---|---|
| `xtest.py` | Library + CLI: focus a window, press/hold/tap keys, click (aimed, then verified with `pointer`), screenshot (`shot`/`rootshot`), list windows (`wins`) |
| `timer_walk.py` | Walks the timer through all five states and captures each one |
| `keyprobe.mjs` | Minimal node-gtk app that logs raw key events (for plumbing bugs) |
| `colview_probe.mjs` | Mini ColumnView: factory setup/bind, position → id, the multi-select walk, ActionBar reveal (the sidebar plumbing) |
| `sidebar_probe.mjs` | Rebuilds main.ts's `OverlaySplitView` with the real sidebar: property readback, own minimum, clamped width (logical px — see trap 6) |
| `scramble_probe.ts` | Headless: generates all 206 scramble types through the real worker (no display needed) |
| `breakpoint_probe.mjs` | Adaptive-layout plumbing: `Adw.Breakpoint::apply/unapply` fire under node-gtk with current sizes, all five disjoint bands fire on every crossing, `Gdk.Surface::layout` reports each resize, `set_default_size` does not resize a presented window |
| `prefs_probe.mjs` | Headless: the real Preferences dialog — every preference read back from the live widgets |
| `edit_dialog_probe.mjs` | Headless: the edit dialog end to end — row order and geometry, the scramble expander, save/discard paths, the form scroll view at a clamped parent |
| `floor_probe.mjs` | Headless (X11): the window floor — `heightRequest` floors the widget on allocation **and** against a forced `xdotool` resize (the AGENTS floor-line numbers) |
| `preview_probe.mjs` | Headless: Adaptive Preview premises — content sits in the emulated screen and the window's breakpoints measure that screen (what makes content-basis ground correct) |
| `content_min_probe.mjs` | Headless: the main stack's minimum per widget at floor widths — bars + panel + timer, text- and width-independent (the 294-floor fit) |
| `rust-embed/` | **Research only, not a UI harness**: runs `cstimer_module` inside six Rust JS engines (rquickjs, boa, deno_core, rusty_v8, JavaScriptCore, libnode) and diffs all 206 scrambles against Node. Findings in `../RUST-PORT.md`; `rust-embed/run.sh` runs the fast engines (~40 s), `SLOW=1` adds the two interpreters (~11 min). Needs a Rust toolchain, not GTK. |

## Requirements

- The app running **on X11**, not native Wayland:
  `GDK_BACKEND=x11 npm start` (XWayland is fine — it is what you get by
  adding that flag inside a Wayland session), **or better, the nested
  display below**.
- Python 3 with `libX11` and `libXtst` (standard on any X system).
- ImageMagick's `import` for screenshots.

## Recommended workflow: drive a nested display (Xephyr)

Run the app on its own X server instead of the live desktop — this sidesteps
traps 1, 2, 4 and 5 in one move:

```sh
Xephyr :99 -screen 1280x800 -ac -br &          # nested X server = a window on your desktop
pkill -f "[n]ode-gtk/register"                 # trap 3: only one instance per session bus
DISPLAY=:99 GDK_BACKEND=x11 npm start &
DISPLAY=:99 python3 tools/xtest.py --window "csTimer GTK" \
  tap ctrl+e sleep 0.5 shot out.png
```

Why it is worth the two extra prefixes (`xtest.py`, `maim`, `xwininfo` all
read `$DISPLAY`):

- **XTEST there is plain X11** — no RemoteDesktop consent prompt, ever
  (trap 4). The nested window stays on your desktop, so a human can still
  watch the test run.
- No physical mouse or window drag to fight. **But trap 2 is not gone**:
  on the nested display `shot` *and* `rootshot` have returned frames
  *minutes* old — a whole session-menu state replayed while the live window
  already showed something else (XGetImage reads server buffers GTK's GL
  rendering does not promise to update). `cmp` only proves two grabs agree,
  not that they are current: verify state changes against the store
  (`jq …/sessions/_index.json`) or a human watching the window, and trust a
  pixel only when it *differs* from the pre-action frame in the way the
  action should change it.
- Windows sit at known coordinates with **1× pixels and no shadows** —
  window-relative = root-relative, no HiDPI (trap 6) arithmetic.
- Popups (menus, popovers) are ordinary toplevels *of the nested server*,
  so `rootshot`/`popup` see them instead of the solid black the live
  XWayland root gives (trap 4's caveat).
- **One caveat — physical keys ≠ XWayland**: a *human* holding a key in
  Xephyr runs the nested server's stock XKB auto-repeat, which can emit
  release/press *pairs* mid-hold. That fakes an inspection bug (green
  "Release to start" bouncing back to red "Keep holding…" with the
  countdown already eating seconds) which does **not** reproduce on the
  same machine under GNOME with either backend — Wayland, or
  `GDK_BACKEND=x11` (xlsclients-confirmed XWayland). Synthetic
  `press`/`hold` never auto-repeats, so automation
  will not see it either: verify hold flows with synthetic input, and
  distrust a bounce seen only under a physical hand in Xephyr.

## The six traps these tools work around

1. **Focus.** X sends keys to whichever window owns focus. `App()` takes focus
   and reads it back to verify; otherwise keystrokes land somewhere else and
   the test silently does nothing.

2. **Stale screenshots.** `XGetImage` on an XWayland surface regularly returns
   an *old* frame while the app is painting perfectly well — three
   consecutive screenshots spanning 3 s of live counting have come back byte
   identical, which looks exactly like a frozen app. `capture()` therefore
   forces a full repaint first (a resize by a few pixels makes GTK redraw the
   whole surface), which usually refreshes what the X server holds.

   "Usually" is honest: it can still catch the same buffer twice, which is
   why `timer_walk.py` compares consecutive frames and warns about repeats.
   Identical frames mean *a stale grab*, not a frozen app — the state machine
   and input handling are unaffected (confirmed by logging every key event
   and transition while the walk ran: all five states, correct timing).
   Re-run, or look at the window with your own eyes. Staleness is not
   XWayland-specific: the nested server does it too (see the workflow
   section above).

   The settle costs ~0.35 s, so for short-lived states pass
   `force_repaint=False` / `--no-repaint`: a 300 ms hold threshold will not
   wait for your screenshot. `timer_walk.py` does exactly this for the
   "holding" shot.

   Corollary: a forced repaint proves the *content* is right, not that the app
   repaints by itself. To test self-initiated painting, compare a raw
   (`--no-repaint`) capture against the previous one — and prefer the app's
   own behaviour (logs, state) over pixels for anything timing-related.

   And one thing a capture can show that the app does not put there: **the
   pointer**. `maim` includes the cursor, and Xephyr runs with no cursor
   theme, so the X server draws its fallback — a heavy black ✕ — wherever
   the mouse happens to be parked. An ✕ floating over the header looks
   exactly like a broken icon or a stray widget: `xdotool mousemove 60 600`
   it out of the way and re-shoot before believing it (one once sat beside
   the copy button and read as a second, mystery button).

3. **A duplicate instance quits instantly.** `Adw.Application` is a
   single-instance `GApplication`: starting a second copy while one is alive
   hands the activate to the first and exits with code 0, so the walk finds
   the *old* window and your fresh changes are never exercised. If the app
   appears to die on launch, check first: `pgrep -fa "node-gtk/register"`.
   Kill leftovers with the bracketed pattern — `pkill -f "[n]ode-gtk/register"`
   (or `pkill -f "[t]sx.*src/main.ts"` for the `npm start` form). The
   brackets are not decoration: an unbracketed pattern matches the very shell
   running the `pkill` command line, so it kills itself instead of the app.

4. **Synthetic input demands a portal approval on the live Wayland session —
   keys *and* clicks.** XWayland implements XTEST through libei (mutter ≥ 45),
   and emulated input is gated behind GNOME's
   `org.freedesktop.portal.RemoteDesktop.CreateSession` consent: the first
   synthetic key or button event pops the "desktop sharing" prompt, and while
   it sits unanswered it owns keyboard focus — every later key goes to the
   dialog instead of the app, which is what "weird test results" look like
   (probes confirmed: key taps and a single
   click each summon it immediately, while focus grabs, screenshots and
   window enumeration do not). **The fix is the nested display above**, where
   XTEST is plain X11
   and never asks; if you must drive the live screen, a human answers the
   prompt first. Even then some targets are unverifiable headlessly: popups
   and the root window capture solid black, so a dropdown opening *cannot* be
   confirmed from a screenshot — have a human look, or verify the effect
   instead of the popup (e.g. the selection label changing in the header).
   **Policy: don't rely on mouse clicks in tests at
   all — trigger actions through keybindings.** Every menu/dialog action gets
   an accelerator (`app.setAccelsForAction` in `src/main.ts`, documented in
   `src/ui/shortcuts.ts`), and tests press keys; on the nested display that
   sidesteps the portal prompt, the physical-mouse fight below, and the
   black-popup problem in one move. If a new action has no key yet, add one
   *before* testing it.
   Input occasionally goes quiet for
   every app after a restart of the session: confirm with `keyprobe.mjs` before
   blaming the app, and if keys do reach the app but nothing changes, drop a
   temporary `console.error` in the handler to see the event arrive.

5. **The window moves, so a click can land off it — verify, don't assume.**
   `xtest` reads the window origin from `xwininfo` once per run and aims every
   click there, but a human dragging the window (or a WM animation) invalidates
   that origin *mid-run*: the warp then parks the pointer over empty root —
   `pointer` prints `over=0x0` — and the click hits nothing while the test
   cheerfully reports success. Two habits fix it: run a whole scenario in
   **one** `xtest` invocation (a single origin read) with `pointer` after each
   `click`, treating `over=0x<window id>` as "landed" and `0x0` as "re-read
   the origin and retry"; and reach for *keys* once focus is in the app, since
   key events go to the focused window wherever it is on screen. A
   screenshot showing "nothing happened" may just mean the click landed on the
   desktop beside the app. And the origin can be
   correct while the world is not: if the user is driving the same machine,
   every warp fights their hand — `over=0x0` with perfectly right math, and a
   `rootshot` that comes back solid black mid-drag (trap 4) while the window
   `shot` still shows the truth. When that happens (or the user offers to
   help test, per AGENTS.md), stop synthesising and hand the run over.

   Two safety nets now live in `App.close()`: every key the run pressed and
   did not release gets released, and keyboard focus is handed back to whoever
   had it before the run. Both were written after real damage: an unpaired
   `press`/`hold` leaves X believing the key is physically down, which makes
   the *user's* real presses on that key do nothing (Space and Escape were
   broken this way), and without the handback every run left the user's
   keystrokes going to the app under test.

   Note what `hold KEY SECS` means: press and **keep holding** for SECS — it
   does not release (only `tap` does). Pair it with an explicit `release KEY`,
   or use `press`/`sleep`/`release` for anything that arms the timer (e.g. the
   WCA inspection hold). A run that ends with Space still held makes every
   later shot in it show the same frozen `ready` frame — and the exit safety
   then releases the key *after* the screenshots, silently starting whatever
   the pending release was supposed to start (two "identical" frames and a
   mystery leftover inspection).

6. **HiDPI: screenshot pixels are physical, widget sizes are logical.** This
   machine runs the X11 session at scale 2 (`Xft.dpi: 192` = 96 × 2). The
   screen itself follows the monitor, so read it fresh with `xwininfo -root`;
   logical width is
   always half the physical. GTK lays out in *logical*
   px and the compositor renders each at 2×, so every measurement needs
   halving before it can be compared with a config value. Worked example: the
   solve sidebar measured **478 physical px** in
   screenshots while `maxSidebarWidth: 320` claimed it could never exceed
   320 — which looked like a libadwaita bug. It wasn't: the window is
   `setDefaultSize(900, …)` = 900 *logical* wide, so the sidebar computes
   `CLAMP(0.25 × 900, 240, 320)` = **240 logical = its minimum** → 480
   physical ≈ the 478 measured (max only binds from 1280 logical up; a
   probe at 1728 logical correctly clamped to 320). Corollaries: `xwininfo`
   and `identify` report physical sizes (1900 ≈ `(900 + 2×25) × 2` incl.
   CSD shadow), and `xdotool windowsize 1900 1180` against a window already
   ~1900 physical is a **no-op** — which is why a resize-based test appeared
   to hang. Rule: before trusting a pixel count, derive the scale from
   something known (window default size vs `xwininfo`, row height vs GTK's
   ~34 logical default) and never mix units in one comparison.

## Recipes

```sh
# all five timer states + a checklist of what each image should show
GDK_BACKEND=x11 npm start &
python3 tools/timer_walk.py --out /tmp/shots

# one-shot scripted interaction (flags come before the command list)
python3 tools/xtest.py --window "csTimer GTK" \
    press space sleep 0.6 shot ready.png release space \
    sleep 1.0 press x release x sleep 0.2 shot stopped.png

# debug key plumbing: does GTK see the event at all, and with what signature?
GDK_BACKEND=x11 node --import tsx --import node-gtk/register tools/keyprobe.mjs &
python3 tools/xtest.py --window KeyProbe press space sleep 0.6 release space tap x

# zero-freeze timing test: hold 0.35 s -> run -> stop at 0.40 s.
# --no-repaint matters: a forced repaint's 0.35 s settle would outlast the hold.
# The big digits must read ~0.40 (timing uses GLib monotonic µs in the key
# handler, so a stall on the main thread would show up as drift here).
python3 tools/xtest.py --no-repaint \
    hold space 0.35 release space sleep 0.40 \
    press x release x sleep 0.6 shot timing.png

# Solve-list deletion: select three rows (Shift+Down extends natively) and delete them.
# The pointer is aimed once and re-checked (`pointer` must print the window
# id, not 0x0); after that everything is keys — the Delete key — so the
# origin can move without breaking the test.
python3 tools/xtest.py --window "csTimer GTK" \
    click 1740 240 pointer sleep 0.3 \
    press Shift_L press Down release Down press Down release Down release Shift_L \
    sleep 0.3 shot selected.png \
    press Delete release Delete sleep 0.6 shot deleted.png
# …then click the toast's Undo (bottom-centre, window-relative) in the same
# invocation and screenshot again to prove the batch came back.

# The scramble-type chooser: a header *button* opening an Adw.Dialog — not a
# popup. The type text lives in the header's
# title/subtitle (Adw.WindowTitle); the control is an icon-only button
# packed after refresh/copy (≈160,28 at 900px window-relative, sidebar
# closed — re-verify the x before trusting it, coords in this file drift).
# Walk Tab until the focus ring is on it (focus is sticky, so there is no
# fixed stop count; order: sidebar → refresh → copy → select)
# and press Return. The dialog focuses its own list, so Down + Return picks
# straight away; there is no search entry — rows are
# browsed, not filtered.
python3 tools/xtest.py --window "csTimer GTK" \
    click 160 28 sleep 0.6 \
    press Down release Down sleep 0.3 \
    press Return release Return sleep 1.5 shot type-switched.png

# Per-session scramble type: the index file is ground truth for this
# feature — screenshots go stale (trap 2), so pair every switch with jq.
jq -c '{active, t: [.sessions[] | {id, scrambleType}]}' \
    ~/.local/share/cstimer-gtk/sessions/_index.json

# Adaptive layout: the whole band walk is sizes and keys, and every step
# announces the tier it applied. Ctrl+B is `app.sidebar` and Escape closes the
# drawer (only while one is up), so neither needs the pointer.
W=$(DISPLAY=:99 xdotool search --name csTimer | head -1)
tail -f /tmp/m6.log | grep --line-buffered '\[layout\]\|\[sidebar\]' &
DISPLAY=:99 xdotool windowsize --sync $W 700 540   # drawer, selectors still in the header
DISPLAY=:99 xdotool windowsize --sync $W 550 480   # selectors leave for their own row
DISPLAY=:99 xdotool key ctrl+b                     # drawer opens   (log: activate → true)
DISPLAY=:99 xdotool key Escape                     # drawer closes  (log: show-sidebar=false)
DISPLAY=:99 xdotool windowsize --sync $W 400 360   # the floor: nothing may clip or warn
DISPLAY=:99 xdotool windowsize --sync $W 1700 900  # tier L: sidebar stays 320 (the cap at every tier), timer l
# `xdotool windowsize` is *surface* px: the widget is 10 smaller (CSD shadow),
# which is why the log prints `890x530 (win 530)` for a 900x540 window.

# Long labels do not move the selectors out: the header's control is
# one button whose label *ellipsizes* instead of forcing Gtk.HeaderBar to
# keep its natural width. Select the catalogue's worst pair (FTO category +
# Diamond type, 52 chars) and check three things:
#   • `[layout] … selectors in the header` at 900/700/541 and `in their own
#     row` only at ≤540 — the labels are not part of that decision;
#   • the minimize/maximize/close buttons stay on screen at every width,
#     including side-by-side with the sidebar open (header ≈ w − 240);
#   • the label reads `…` under that squeeze rather than shoving the
#     window controls over the edge.
jq '(.sessions[] | select(.id == "default")).scrambleType = "dmdso"' \
    ~/.local/share/cstimer-gtk/sessions/_index.json > /tmp/idx && \
    cp /tmp/idx ~/.local/share/cstimer-gtk/sessions/_index.json
# …restart, walk 1700/900/700/541/540, then restore with _index.json.bak.
```

Key names are X keysym names: `space`, `Return`, `Escape`, `a`, `z`, `F5`, …
