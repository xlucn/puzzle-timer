# tools/ — manual UI verification

Helpers for driving the running app on a nested X server. **These are not
part of `cargo test`** — unit tests cover `src/core/`, these cover the GTK
layer. The v0.3.0 node-gtk probe suite (`.mjs`) lives on branch `legacy`;
its probes are being ported to Rust during M18.

| File | What it does |
|---|---|
| `xtest.py` | Library + CLI: focus a window, press/hold/tap keys, click (aimed, then verified with `pointer`), hold and drag the pointer (`down`/`up`/`drag`), screenshot (`shot`/`rootshot`), list windows (`wins`) |
| `timer_walk.py` | Walks the v0.3.0 timer through its states and captures each one; re-port with the UI |
| `rust-embed/` | **Research only, not a UI harness**: runs `cstimer_module` inside six Rust JS engines and diffs all 206 scrambles against Node. Findings in `../RUST-PORT.md`; `rust-embed/run.sh` runs the fast engines (~40 s), `SLOW=1` adds the two interpreters (~11 min). Needs a Rust toolchain, not GTK |

## Requirements

- The app on **X11**, not native Wayland: run it on the nested display below,
  or add `GDK_BACKEND=x11`.
- Python 3 with `libX11` and `libXtst` (standard on any X system).
- ImageMagick's `import` for screenshots.

## Driving a nested display (Xephyr)

```sh
Xephyr :99 -screen 1280x800 -ac -br &          # a window on your desktop
pkill -f 'target/debug/puzzle-timer'            # only one GApplication instance
DISPLAY=:99 GDK_BACKEND=x11 cargo run &
DISPLAY=:99 python3 tools/xtest.py --window "Puzzle Timer" \
  tap ctrl+q sleep 0.5
```

Why the two extra prefixes (`xtest.py`, `import` and `xwininfo` all read
`$DISPLAY`):

- **XTEST there is plain X11** — no GNOME RemoteDesktop consent prompt. The
  nested window stays visible, so a human can still watch the run.
- Windows sit at known coordinates with **1× pixels and no shadows**, so
  window-relative equals root-relative.
- Popups are ordinary toplevels of the nested server, so `rootshot` sees them
  instead of the black rectangle the live XWayland root gives.
- **Caveat:** a *human* holding a key in Xephyr runs the nested server's stock
  XKB auto-repeat, which can emit release/press pairs mid-hold. Synthetic
  `press`/`hold` never auto-repeats; verify hold flows synthetically, and
  distrust a bounce seen only under a physical hand.

Start the app **detached from the tool call**:
`setsid bash -c 'DISPLAY=:99 GDK_BACKEND=x11 cargo run > LOG 2>&1' &`. A
`(cargo run … &)` dies with the call's process group and can read like a
crash.

## The traps these tools work around

1. **Focus.** X sends keys to whichever window owns focus. `App()` takes focus
   and reads it back to verify; otherwise keystrokes land somewhere else and
   the test silently does nothing.

2. **Stale screenshots.** `XGetImage` regularly returns an *old* frame while
   the app is painting perfectly well. `capture()` forces a repaint first (a
   resize by a few pixels), which usually refreshes the buffer. "Usually" is
   honest: it can still catch the same buffer twice. Identical frames mean *a
   stale grab*, not a frozen app — verify state against the store or a log,
   and re-run rather than looping on retries. The settle costs ~0.35 s; pass
   `force_repaint=False` / `--no-repaint` for short-lived states.
   A capture also includes the pointer; Xephyr draws a heavy black ✕ where
   the mouse is parked. `xdotool mousemove 60 600` it out of the way before
   believing an artifact.

3. **A duplicate instance quits instantly.** `Adw.Application` is a
   single-instance `GApplication`: a second copy hands `activate` to the
   first and exits 0, so the walk finds the *old* window. Check
   `pgrep -fa 'target/debug/puzzle-timer'` and kill leftovers with a bracketed
   pattern (`pkill -f 'target/debug/puzzle-[t]imer'`); an unbracketed pattern
   matches the shell running the `pkill` and kills itself.

4. **Synthetic input demands portal approval on the live Wayland session —
   keys *and* clicks.** XWayland implements XTEST through libei, gated behind
   GNOME's RemoteDesktop consent; while the prompt is unanswered it owns
   keyboard focus. The nested display avoids it. Even there, popups and the
   root window can capture black, so verify the effect, not the popup.
   **Policy: trigger actions through keybindings, not clicks.** Every action
   gets an accelerator before it is tested.

5. **The window moves, so a click can land off it — verify, don't assume.**
   `xtest` reads the origin once per run; a human dragging the window
   invalidates it mid-run. Run a scenario in **one** invocation, with
   `pointer` after each click (`over=0x<window id>` = landed, `0x0` =
   re-read and retry), and prefer keys once focus is in the app. If the user
   is driving the same machine, stop synthesising and hand the run over.

6. **HiDPI: screenshot pixels are physical, widget sizes are logical.**
   Read the scale from `xwininfo -root`; GTK lays out in logical px and the
   compositor renders at 2×. Never mix units in one comparison.

## Keyboard walk

The Rust UI's accelerators arrive with the UI port. Until then, drive the
app with `xtest.py` and check state from logs or the store; the v0.3.0
keyboard walk (Ctrl+S session menu, Ctrl+T statistics, Ctrl+M sessions,
Ctrl+comma preferences, F11 fullscreen, Ctrl+Q quit) is on the `legacy`
branch and is the target to re-establish.

## Recipes

```sh
# all timer states (v0.3.0; re-port with the Rust timer)
GDK_BACKEND=x11 cargo run &
python3 tools/timer_walk.py --out /tmp/shots

# one-shot scripted interaction (flags come before the command list)
python3 tools/xtest.py --window "Puzzle Timer" \
    press space sleep 0.6 shot ready.png release space \
    sleep 1.0 press x release x sleep 0.2 shot stopped.png

# zero-freeze timing: hold 0.35 s -> run -> stop at 0.40 s
python3 tools/xtest.py --no-repaint \
    hold space 0.35 release space sleep 0.40 \
    press x release x sleep 0.6 shot timing.png
```

Key names are X keysym names: `space`, `Return`, `Escape`, `a`, `z`, `F5`, …
