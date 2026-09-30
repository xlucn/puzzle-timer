# tools/ — manual UI verification

Helpers for driving the running app with synthetic keyboard input and
photographing it, so UI behaviour can be checked without a human at the
keyboard. **These are not part of `npm test`** — unit tests cover `src/core/`;
these cover the part Vitest cannot, which is the GTK layer.

| File | What it does |
|---|---|
| `xtest.py` | Library + CLI: focus a window, press/hold/tap keys, click, screenshot (`shot`/`rootshot`), list windows (`wins`) |
| `timer_walk.py` | Walks the timer through all five states and captures each one |
| `keyprobe.mjs` | Minimal node-gtk app that logs raw key events (for plumbing bugs) |
| `scramble_probe.ts` | Headless: generates all 206 scramble types through the real worker (no display needed) |

## Requirements

- The app running **on X11**, not native Wayland:
  `GDK_BACKEND=x11 npm start` (XWayland is fine — it is what you get by
  adding that flag inside a Wayland session).
- Python 3 with `libX11` and `libXtst` (standard on any X system).
- ImageMagick's `import` for screenshots.

## The four traps these tools work around

1. **Focus.** X sends keys to whichever window owns focus. `App()` takes focus
   and reads it back to verify; otherwise keystrokes land somewhere else and
   the test silently does nothing.

2. **Stale screenshots.** `XGetImage` on an XWayland surface regularly returns
   an *old* frame while the app is painting perfectly well — during M0 three
   consecutive screenshots spanning 3 s of live counting came back byte
   identical, which looks exactly like a frozen app. `capture()` therefore
   forces a full repaint first (a resize by a few pixels makes GTK redraw the
   whole surface), which usually refreshes what the X server holds.

   "Usually" is honest: it can still catch the same buffer twice, which is
   why `timer_walk.py` compares consecutive frames and warns about repeats.
   Identical frames mean *a stale grab*, not a frozen app — the state machine
   and input handling are unaffected (this was confirmed by logging every key
   event and transition while the walk ran: all five states, correct timing).
   Re-run, or look at the window with your own eyes.

   The settle costs ~0.35 s, so for short-lived states pass
   `force_repaint=False` / `--no-repaint`: a 300 ms hold threshold will not
   wait for your screenshot. `timer_walk.py` does exactly this for the
   "holding" shot.

   Corollary: a forced repaint proves the *content* is right, not that the app
   repaints by itself. To test self-initiated painting, compare a raw
   (`--no-repaint`) capture against the previous one — and prefer the app's
   own behaviour (logs, state) over pixels for anything timing-related.

3. **A duplicate instance quits instantly.** `Adw.Application` is a
   single-instance `GApplication`: starting a second copy while one is alive
   hands the activate to the first and exits with code 0, so the walk finds
   the *old* window and your fresh changes are never exercised. If the app
   appears to die on launch, check first: `pgrep -fa "node-gtk/register"`.
   Kill leftovers with `pkill -f "node-gtk/register"`.

4. **Synthetic *mouse* clicks need a portal approval; keys do not.** XTEST key
   events go straight to the focused X window, but the first synthetic button
   click triggers GNOME's
   `org.freedesktop.portal.RemoteDesktop.CreateSession` prompt — a human has to
   approve "desktop sharing" once, after which clicks land. Even then some
   targets are unverifiable headlessly: popups and the root window capture
   solid black, so a dropdown opening *cannot* be confirmed from a screenshot —
   have a human look, or verify the effect instead of the popup (e.g. the
   selection label changing in the header). Input occasionally goes quiet for
   every app after a restart of the session: confirm with `keyprobe.mjs` before
   blaming the app, and if keys do reach the app but nothing changes, drop a
   temporary `console.error` in the handler to see the event arrive.

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

# zero-freeze timing test (M1 acceptance): hold 0.35 s -> run -> stop at 0.40 s.
# --no-repaint matters: a forced repaint's 0.35 s settle would outlast the hold.
# The big digits must read ~0.40 (timing uses GLib monotonic µs in the key
# handler, so a stall on the main thread would show up as drift here).
python3 tools/xtest.py --no-repaint \
    hold space 0.35 release space sleep 0.40 \
    press x release x sleep 0.6 shot timing.png
```

Key names are X keysym names: `space`, `Return`, `Escape`, `a`, `z`, `F5`, …
