#!/usr/bin/env python3
"""
Synthetic X11 input + window capture: drive a GTK app without a human.

Why this exists: verifying "hold Space -> red -> green -> release -> counts ->
any key stops" needs real key events, and verifying that the UI actually
painted needs screenshots. Neither can be done from inside the app itself.

The app must be running on X11/XWayland, not native Wayland:

    GDK_BACKEND=x11 npm start

Two traps found the hard way during M0 (recorded in PLAN.md §5) and handled
here:

* Focus — X delivers keys to whichever window owns focus, which is not
  necessarily ours. App() takes focus and reads it back to verify; pass
  focus=False for capture-only use.

* Stale frames — XGetImage on an XWayland surface regularly returns an OLD
  frame while the app is in fact painting fine (observed: three identical
  screenshots spanning 3 s of live counting). capture() therefore forces a
  full repaint first — resize by a few pixels, let GTK settle — which
  reliably refreshes the server-side content. The settle costs ~0.35 s, so
  pass force_repaint=False for short-lived states: a 300 ms hold threshold
  will not wait for a screenshot.

Requires libX11, libXtst (present on any X system) and ImageMagick's
`import`.

One-shot command list (flags come before the list):

    python3 tools/xtest.py --window "csTimer GTK" \\
        press space sleep 0.6 shot ready.png release space \\
        sleep 1.0 press x release x sleep 0.2 shot stopped.png

As a library:

    from xtest import App

    app = App()
    app.hold("space", 0.6)      # press and keep holding
    app.capture("ready.png")    # ...still holding while it shoots
    app.release("space")        # the solve starts here
    app.tap("x")                # any key stops it
"""

from __future__ import annotations

import argparse
import ctypes
import subprocess
import sys
import time

DEFAULT_WINDOW = "csTimer GTK"

# Forced repaint: a resize makes GTK redraw the whole surface, which is what
# gets the pixels into the X drawable that ImageMagick reads back.
RESIZE_DELTA = 8
REPAINT_SETTLE = 0.35
RESTORE_SETTLE = 0.2

OPS_HELP = """command list, executed in order:
  press KEY             push a key down
  release KEY           let a key back up
  hold KEY SECS         press and keep holding for SECS
  tap KEY [SECS]        press, wait (default 0.05 s), release
  sleep SECS            wait
  shot PATH             screenshot (forces a repaint first unless --no-repaint)

Key names are X keysym names: space, Return, Escape, a, z, F5, ...
"""


def _declare(x11, xtst):
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    x11.XDefaultRootWindow.restype = ctypes.c_ulong
    x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    x11.XStringToKeysym.restype = ctypes.c_ulong
    x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
    x11.XKeysymToKeycode.restype = ctypes.c_ubyte
    x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XQueryTree.restype = ctypes.c_int
    x11.XQueryTree.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.POINTER(ctypes.c_ulong),
        ctypes.POINTER(ctypes.c_ulong),
        ctypes.POINTER(ctypes.POINTER(ctypes.c_ulong)),
        ctypes.POINTER(ctypes.c_uint),
    ]
    x11.XFetchName.restype = ctypes.c_int
    x11.XFetchName.argtypes = [
        ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_char_p)
    ]
    x11.XFree.argtypes = [ctypes.c_void_p]
    x11.XSetInputFocus.argtypes = [
        ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong
    ]
    x11.XGetInputFocus.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_ulong),
        ctypes.POINTER(ctypes.c_int),
    ]
    x11.XGetGeometry.restype = ctypes.c_int
    x11.XGetGeometry.argtypes = [
        ctypes.c_void_p,                 # Display *
        ctypes.c_ulong,                  # Drawable
        ctypes.POINTER(ctypes.c_ulong),  # Window *root_return
        ctypes.POINTER(ctypes.c_int),    # int *x_return
        ctypes.POINTER(ctypes.c_int),    # int *y_return
        ctypes.POINTER(ctypes.c_uint),   # unsigned int *width_return
        ctypes.POINTER(ctypes.c_uint),   # unsigned int *height_return
        ctypes.POINTER(ctypes.c_uint),   # unsigned int *border_width_return
        ctypes.POINTER(ctypes.c_uint),   # unsigned int *depth_return
    ]
    x11.XResizeWindow.argtypes = [
        ctypes.c_void_p, ctypes.c_ulong, ctypes.c_uint, ctypes.c_uint
    ]
    x11.XFlush.argtypes = [ctypes.c_void_p]
    xtst.XTestFakeKeyEvent.restype = ctypes.c_int
    xtst.XTestFakeKeyEvent.argtypes = [
        ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong
    ]


def _walk(x11, d, window, title):
    """Depth-first search of the X tree for a window whose name contains title."""
    root_ret, parent = ctypes.c_ulong(), ctypes.c_ulong()
    children = ctypes.POINTER(ctypes.c_ulong)()
    n = ctypes.c_uint()
    if not x11.XQueryTree(
        d, window, ctypes.byref(root_ret), ctypes.byref(parent),
        ctypes.byref(children), ctypes.byref(n),
    ):
        return None
    try:
        for i in range(n.value):
            child = children[i]
            name = ctypes.c_char_p()
            if x11.XFetchName(d, child, ctypes.byref(name)) and name.value:
                if title in name.value.decode(errors="replace"):
                    return child
            found = _walk(x11, d, child, title)
            if found:
                return found
    finally:
        if children:
            x11.XFree(children)
    return None


def _find_window(x11, d, root, title, timeout):
    deadline = time.time() + timeout
    while True:
        found = _walk(x11, d, root, title)
        if found:
            return found
        if time.time() > deadline:
            sys.exit(
                f"window {title!r} not found after {timeout:.0f}s — is the app "
                "running, and on X11 (GDK_BACKEND=x11)?"
            )
        time.sleep(0.5)


class App:
    """A handle on one app window: focus it, poke it, photograph it."""

    def __init__(self, title: str = DEFAULT_WINDOW, timeout: float = 20.0, focus: bool = True):
        self.x11 = ctypes.CDLL("libX11.so.6")
        self.xtst = ctypes.CDLL("libXtst.so.6")
        _declare(self.x11, self.xtst)

        self.d = self.x11.XOpenDisplay(None)
        if not self.d:
            sys.exit("cannot open the X display — is DISPLAY set?")

        self.root = self.x11.XDefaultRootWindow(self.d)
        self.title = title
        self.win = _find_window(self.x11, self.d, self.root, title, timeout)
        print(f"window: {title!r} = 0x{self.win:x}")

        if focus:
            self.focus()

    # -- lifecycle ---------------------------------------------------------
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False

    def close(self):
        if getattr(self, "d", None):
            self.x11.XCloseDisplay(self.d)
            self.d = None

    # -- focus -------------------------------------------------------------
    def focus(self):
        """Take keyboard focus (RevertToParent) and verify it stuck."""
        self.x11.XSetInputFocus(self.d, self.win, 2, 0)
        self.x11.XFlush(self.d)
        time.sleep(0.2)

        focus, _revert = ctypes.c_ulong(), ctypes.c_int()
        self.x11.XGetInputFocus(self.d, ctypes.byref(focus), ctypes.byref(_revert))
        if focus.value != self.win:
            sys.exit(
                f"could not focus 0x{self.win:x} (focus is 0x{focus.value:x}); "
                "key injection would hit the wrong window"
            )
        print("focus: ok")

    # -- keys --------------------------------------------------------------
    def keycode(self, key: str) -> int:
        keysym = self.x11.XStringToKeysym(key.encode())
        if keysym == 0:
            sys.exit(
                f"unknown key {key!r} — use X keysym names "
                "(space, Return, Escape, a, z, F5, ...)"
            )
        code = self.x11.XKeysymToKeycode(self.d, keysym)
        if code == 0:
            sys.exit(f"key {key!r} has no keycode in the current layout")
        return code

    def press(self, key: str):
        self.xtst.XTestFakeKeyEvent(self.d, self.keycode(key), 1, 0)
        self.x11.XFlush(self.d)

    def release(self, key: str):
        self.xtst.XTestFakeKeyEvent(self.d, self.keycode(key), 0, 0)
        self.x11.XFlush(self.d)

    def hold(self, key: str, seconds: float):
        """Press and keep holding — for states that only exist while held."""
        self.press(key)
        time.sleep(seconds)

    def tap(self, key: str, seconds: float = 0.05):
        self.press(key)
        time.sleep(seconds)
        self.release(key)
        time.sleep(0.1)

    # -- capture -----------------------------------------------------------
    def size(self):
        scr, x, y = ctypes.c_ulong(), ctypes.c_int(), ctypes.c_int()
        w, h, border, depth = (ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint())
        self.x11.XGetGeometry(
            self.d, self.win, ctypes.byref(scr), ctypes.byref(x), ctypes.byref(y),
            ctypes.byref(w), ctypes.byref(h), ctypes.byref(border), ctypes.byref(depth),
        )
        return w.value, h.value

    def force_repaint(self, settle: float = REPAINT_SETTLE):
        """Nudge GTK into redrawing the whole surface; returns the original size."""
        w, h = self.size()
        self.x11.XResizeWindow(self.d, self.win, w + RESIZE_DELTA, h)
        self.x11.XFlush(self.d)
        time.sleep(settle)
        return w, h

    def restore(self, geom, settle: float = RESTORE_SETTLE):
        w, h = geom
        self.x11.XResizeWindow(self.d, self.win, w, h)
        self.x11.XFlush(self.d)
        time.sleep(settle)

    def capture(self, path: str, force_repaint: bool = True):
        """
        Screenshot the window.

        force_repaint=True is the reliable default: it defeats stale frames.
        Set it False when the state being photographed would change during
        the ~0.35 s settle (e.g. a 300 ms hold threshold).
        """
        geom = self.force_repaint() if force_repaint else None
        subprocess.run(["import", "-window", f"0x{self.win:x}", path], check=True)
        if geom:
            self.restore(geom)
        print(f"  captured {path}")
        return path


def _is_float(token: str) -> bool:
    try:
        float(token)
    except ValueError:
        return False
    return True


def _run(app: App, ops: list[str], force_repaint: bool):
    i = 0
    while i < len(ops):
        op = ops[i]
        i += 1
        if op == "press":
            app.press(ops[i])
            i += 1
        elif op == "release":
            app.release(ops[i])
            i += 1
        elif op == "hold":
            key, seconds = ops[i], float(ops[i + 1])
            i += 2
            app.hold(key, seconds)
        elif op == "tap":
            key = ops[i]
            i += 1
            seconds = 0.05
            if i < len(ops) and _is_float(ops[i]):
                seconds = float(ops[i])
                i += 1
            app.tap(key, seconds)
        elif op == "sleep":
            time.sleep(float(ops[i]))
            i += 1
        elif op == "shot":
            app.capture(ops[i], force_repaint=force_repaint)
            i += 1
        else:
            sys.exit(f"unknown op {op!r}\n\n{OPS_HELP}")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="xtest",
        description="Drive a GTK app with synthetic X11 keys and screenshot it.",
        epilog=OPS_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--window", default=DEFAULT_WINDOW,
        help="window title to attach to, matched as a substring (default: %(default)r)",
    )
    parser.add_argument(
        "--no-repaint", action="store_true",
        help="do not force a repaint before each shot (faster, may capture a stale frame)",
    )
    parser.add_argument(
        "--no-focus", action="store_true",
        help="do not take keyboard focus (use for capture-only runs)",
    )
    parser.add_argument("ops", nargs="+", metavar="op", help="command list (see below)")
    args = parser.parse_args(argv)

    with App(args.window, focus=not args.no_focus) as app:
        _run(app, args.ops, force_repaint=not args.no_repaint)
    return 0


if __name__ == "__main__":
    sys.exit(main())
