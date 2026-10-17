#!/usr/bin/env python3
"""
Walk the timer through all five states and screenshot each one.

    GDK_BACKEND=x11 npm start      # terminal 1
    python3 tools/timer_walk.py    # terminal 2

Writes PNGs to a temp directory (--out to override) and prints what each one
should show, so the images double as a checklist. Exits non-zero if two frames
came back identical, which is the signature of a stale grab rather than a
frozen app.

Note on the 'holding' shot: it deliberately skips the forced repaint. The
settle costs ~0.35 s and the app flips holding -> ready after 0.30 s, so a
forced capture would always arrive too late and photograph 'ready' instead.
Everything after that state is stable while we shoot, so those are forced.
"""

import argparse
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xtest import App  # noqa: E402

EXPECTED = [
    ("0-idle.png",    'dim time, hint "Hold Space to start"'),
    ("1-holding.png", 'red 0.00, hint "Keep holding..."'),
    ("2-ready.png",   'green 0.00, hint "Release to start"'),
    ("3-running.png", 'dark counting time, hint "Press any key to stop"'),
    ("4-stopped.png", 'dark frozen result, hint "Hold Space for next solve"'),
    ("5-idle.png",    'dim frozen result, hint "Hold Space to start"'),
]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--window", default="Puzzle Timer")
    parser.add_argument(
        "--out",
        default=os.path.join(tempfile.gettempdir(), "cstimer-gtk-shots"),
        help="directory for the PNGs (default: %(default)s)",
    )
    parser.add_argument(
        "--running-secs", type=float, default=1.2,
        help="how long to time before stopping (default: %(default)s)",
    )
    args = parser.parse_args(argv)

    os.makedirs(args.out, exist_ok=True)
    shot = lambda name: os.path.join(args.out, name)  # noqa: E731

    with App(args.window) as app:
        # 0) idle — nothing is happening yet, so a forced repaint is safe
        app.capture(shot("0-idle.png"))

        # 1) holding — raw capture: the forced repaint would outlast the
        #    300 ms threshold and we would only ever photograph 'ready'
        app.press("space")
        time.sleep(0.15)
        app.capture(shot("1-holding.png"), force_repaint=False)

        # 2) ready — still holding; this state lasts exactly as long as we hold
        time.sleep(0.5)
        app.capture(shot("2-ready.png"))

        # 3) running — release; it keeps counting while we shoot
        app.release("space")
        time.sleep(args.running_secs)
        app.capture(shot("3-running.png"))

        # 4) stopped — any fresh key press freezes the result
        app.tap("x")
        time.sleep(0.2)
        app.capture(shot("4-stopped.png"))

        # 5) a quick tap cancels back to idle, keeping the last result
        app.press("space")
        time.sleep(0.10)
        app.release("space")
        time.sleep(0.3)
        app.capture(shot("5-idle.png"))

    print()
    print(f"Captured to {args.out}/ — each image should show:")
    for name, expect in EXPECTED:
        print(f"  {name:16} {expect}")

    # Two identical frames in a row means we photographed the same server-side
    # buffer twice — a stale capture, not a frozen app (the app keeps its own
    # state; input and timing are unaffected). Re-run the walk.
    stale = [
        (EXPECTED[i - 1][0], EXPECTED[i][0])
        for i in range(1, len(EXPECTED))
        if _digest(shot(EXPECTED[i - 1][0])) == _digest(shot(EXPECTED[i][0]))
    ]
    if stale:
        print()
        print("WARNING: identical frames captured — stale X grabs:")
        for a, b in stale:
            print(f"  {a} == {b}")
        print("Re-run the walk; if it repeats, shoot the suspect states with")
        print("`--no-repaint` and compare, or just look at the window (see")
        print("tools/README.md).")
    return 1 if stale else 0


def _digest(path: str) -> str:
    import hashlib

    with open(path, "rb") as handle:
        return hashlib.md5(handle.read()).hexdigest()


if __name__ == "__main__":
    sys.exit(main())
