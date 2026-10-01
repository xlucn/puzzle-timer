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
  type TEXT             type lowercase letters/digits (for search entries)
  click X Y [BUTTON]    click at window-relative pixels (default button 1)
  warp X Y              move the pointer there, without clicking (hover tests)
  pointer               print where X thinks the pointer is, and what is under it
  sleep SECS            wait
  shot PATH             screenshot (forces a repaint first unless --no-repaint)
  rootshot PATH [window | X Y W H]
                        grab the X root window with maim: bare = whole screen,
                        `window` = the app's rectangle, or X Y W H in root
                        pixels. Unlike `shot` this sees popups/menus, which are
                        separate top-level windows
  wins                  print the root window tree (find popup window ids)
  popup PATH            screenshot the currently open popup (its own X window;
                        must run in the same invocation as the click that
                        opened it -- GTK unmaps it when focus goes)

Key names are X keysym names: space, Return, Escape, a, z, F5, ...
Keys may carry modifier prefixes: ctrl+2, shift+F5, ctrl+shift+a.
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
    x11.XTranslateCoordinates.restype = ctypes.c_int
    x11.XTranslateCoordinates.argtypes = [
        ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong,
        ctypes.c_int, ctypes.c_int,
        ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int),
        ctypes.POINTER(ctypes.c_ulong),
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
    xtst.XTestFakeButtonEvent.restype = ctypes.c_int
    xtst.XTestFakeButtonEvent.argtypes = [
        ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong
    ]
    x11.XWarpPointer.restype = ctypes.c_int
    x11.XWarpPointer.argtypes = [
        ctypes.c_void_p,  # Display *
        ctypes.c_ulong,   # src window
        ctypes.c_ulong,   # dest window
        ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint,
        ctypes.c_int, ctypes.c_int,
    ]
    x11.XQueryPointer.restype = ctypes.c_int
    x11.XQueryPointer.argtypes = [
        ctypes.c_void_p,                   # Display *
        ctypes.c_ulong,                    # Window (query from root)
        ctypes.POINTER(ctypes.c_ulong),    # Window *root_return
        ctypes.POINTER(ctypes.c_ulong),    # Window *child_return
        ctypes.POINTER(ctypes.c_int),      # int *root_x
        ctypes.POINTER(ctypes.c_int),      # int *root_y
        ctypes.POINTER(ctypes.c_int),      # int *win_x
        ctypes.POINTER(ctypes.c_int),      # int *win_y
        ctypes.POINTER(ctypes.c_uint),     # unsigned int *mask
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
        self._held: set[str] = set()  # keys we pressed and have not released yet
        self.prev_focus = 0           # focus owner to restore in close()
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
            # Never leave the machine's keyboard in a state we put it in:
            # release anything still held (an unpaired `press`/`hold` would
            # otherwise leave X believing the key is down, which makes the
            # user's real presses on it do nothing), then give focus back.
            for key in sorted(getattr(self, "_held", set())):
                print(f"safety: releasing still-held key {key!r}")
                self.release(key)
            prev = getattr(self, "prev_focus", 0)
            if prev and prev != self.win:
                self.x11.XSetInputFocus(self.d, prev, 2, 0)  # RevertToParent
                self.x11.XFlush(self.d)
                print(f"focus: handed back to 0x{prev:x}")
            self.x11.XCloseDisplay(self.d)
            self.d = None

    # -- focus -------------------------------------------------------------
    def focus(self):
        """Take keyboard focus (RevertToParent) and verify it stuck."""
        # Remember who had it, so close() can restore it: otherwise every
        # test run leaves the user's keystrokes going to the app under test.
        prev, revert = ctypes.c_ulong(), ctypes.c_int()
        self.x11.XGetInputFocus(self.d, ctypes.byref(prev), ctypes.byref(revert))
        if prev.value not in (0, 1, self.win):  # skip None / PointerRoot
            self.prev_focus = prev.value

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

    # -- root capture ------------------------------------------------------
    def root_shot(self, path: str, geom: tuple[int, int, int, int] | None = None):
        """Grab the X root window with maim.

        Unlike capture(), this sees popups and menus: GTK renders those in
        their own top-level X windows, which never show up when we import
        just the app window.
        """
        cmd = ["maim"]
        if geom:
            w, h, x, y = geom
            cmd += ["-g", f"{w}x{h}+{x}+{y}"]
        cmd.append(path)
        subprocess.run(cmd, check=True)
        print(f"  root-grabbed {path}")
        return path

    def wins(self) -> str:
        """Print the root window tree (window ids, titles, geometry)."""
        out = subprocess.run(
            ["xwininfo", "-root", "-tree"], check=True, capture_output=True, text=True
        ).stdout
        print(out)
        return out

    def _map_state(self, wid: int) -> str:
        """'IsViewable' / 'IsUnMapped' … for a window (empty if lookup fails)."""
        out = subprocess.run(
            ["xwininfo", "-id", hex(wid)], check=True, capture_output=True, text=True
        ).stdout
        for line in out.splitlines():
            if "Map State:" in line:
                return line.split(":", 1)[1].strip()
        return ""

    def shot_child(self, path: str) -> str:
        """Screenshot an open popup.

        GTK popups are their own top-level X window (root children, not
        children of the app window), and they unmap the moment focus goes --
        so this has to run in the same invocation as the click that opened
        them. We take the largest root window that overlaps the app's
        rectangle but is not the app itself: popups anchor over their parent,
        while unrelated windows sit elsewhere on the screen.

        Only *mapped* windows count. GTK keeps each cell's popover window
        alive after closing it, and those stale shells are bigger than the
        live menu -- grabbing one gives a blank image and no idea why.
        """
        ax, ay = self.origin()
        aw, ah = self.size()
        found = []
        for wid in self.root_children():
            if wid == self.win:
                continue
            if self._map_state(wid) != "IsViewable":
                continue
            wx, wy = self._abs_pos(wid)
            w, h = self._geom(wid)
            ox = max(0, min(ax + aw, wx + w) - max(ax, wx))
            oy = max(0, min(ay + ah, wy + h) - max(ay, wy))
            if ox * oy > 10_000:
                found.append((w * h, wid))
        if not found:
            sys.exit("no popup window to shoot (is it still open?)")
        # GTK creates more than one window per popup: an invisible grab overlay
        # plus the visible list. Shoot each; the caller picks the real list.
        for area, wid in sorted(found):
            out = path if len(found) == 1 else path.replace(".png", f"-{wid:x}.png")
            # maim -i, not `import -window`: ImageMagick refuses to read these
            # override-redirect GTK popups ("missing an image filename").
            subprocess.run(["maim", "-i", f"0x{wid:x}", out], check=True)
            print(f"  captured popup 0x{wid:x} ({area}px) -> {out}")
        return path

    def _abs_pos(self, wid: int):
        """Window position in root coordinates (XGetGeometry reports parent-relative)."""
        x, y = ctypes.c_int(), ctypes.c_int()
        self.x11.XTranslateCoordinates(
            self.d, wid, self.root, 0, 0,
            ctypes.byref(x), ctypes.byref(y), ctypes.byref(ctypes.c_ulong()),
        )
        return x.value, y.value

    def root_children(self) -> list[int]:
        """Window ids of the root window's children."""
        root, parent = ctypes.c_ulong(), ctypes.c_ulong()
        kids = ctypes.POINTER(ctypes.c_ulong)()
        n = ctypes.c_uint()
        self.x11.XQueryTree(
            self.d, self.root, ctypes.byref(root), ctypes.byref(parent),
            ctypes.byref(kids), ctypes.byref(n),
        )
        out = [kids[i] for i in range(n.value)]
        if kids:
            self.x11.XFree(kids)
        return out

    def _geom(self, wid: int):
        scr, x, y = ctypes.c_ulong(), ctypes.c_int(), ctypes.c_int()
        w, h, border, depth = (ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint())
        self.x11.XGetGeometry(
            self.d, wid, ctypes.byref(scr), ctypes.byref(x), ctypes.byref(y),
            ctypes.byref(w), ctypes.byref(h), ctypes.byref(border), ctypes.byref(depth),
        )
        return w.value, h.value

    # -- keys --------------------------------------------------------------
    # Modifier prefixes a key spec may carry: `tap ctrl+2`, `press shift+F5`.
    # Matched as whole words so a literal `+` key (`tap plus`) stays a key.
    MOD_PREFIXES = {
        "ctrl": "Control_L",
        "control": "Control_L",
        "shift": "Shift_L",
        "alt": "Alt_L",
        "super": "Super_L",
        "meta": "Super_L",
    }

    def _split_mods(self, spec: str) -> tuple[list[str], str]:
        """Peel modifier prefixes off a key spec: 'ctrl+shift+a' → mods, 'a'."""
        mods: list[str] = []
        while True:
            prefix, sep, rest = spec.partition("+")
            name = self.MOD_PREFIXES.get(prefix.lower())
            if not sep or name is None or not rest:
                return mods, spec
            mods.append(name)
            spec = rest

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
        mods, key = self._split_mods(key)
        for mod in mods:
            self.xtst.XTestFakeKeyEvent(self.d, self.keycode(mod), 1, 0)
            self._held.add(mod)  # released by close() unless paired
        self.xtst.XTestFakeKeyEvent(self.d, self.keycode(key), 1, 0)
        self.x11.XFlush(self.d)
        self._held.add(key)  # released by close() unless paired

    def release(self, key: str):
        mods, key = self._split_mods(key)
        self.xtst.XTestFakeKeyEvent(self.d, self.keycode(key), 0, 0)
        self._held.discard(key)
        for mod in reversed(mods):  # modifiers come off after the key
            self.xtst.XTestFakeKeyEvent(self.d, self.keycode(mod), 0, 0)
            self._held.discard(mod)
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

    def type_text(self, text: str):
        """Type into whatever has focus (search entries, text fields).

        Handles what the tests need: letters (upper- or lowercase), digits,
        space, and _ +. Anything else stops with an error rather than
        silently typing the wrong thing.
        """
        special = {" ": "space", "_": "underscore", "+": "plus", "-": "minus"}
        for ch in text:
            name = special.get(ch, ch)
            keysym = self.x11.XStringToKeysym(name.encode())
            if keysym == 0:
                sys.exit(f"cannot type {ch!r} with the type op")
            code = self.x11.XKeysymToKeycode(self.d, keysym)
            if code == 0:
                sys.exit(f"no keycode for {ch!r} in the current layout")
            shift = ch.isupper() or ch in "_+"
            if shift:
                self.press("Shift_L")
            self.xtst.XTestFakeKeyEvent(self.d, code, 1, 0)
            self.xtst.XTestFakeKeyEvent(self.d, code, 0, 0)
            if shift:
                self.release("Shift_L")
        self.x11.XFlush(self.d)
        time.sleep(0.1)

    def pointer(self):
        """(root_x, root_y, window under the pointer) as X sees it right now."""
        root_ret, child_ret = ctypes.c_ulong(), ctypes.c_ulong()
        rx, ry = ctypes.c_int(), ctypes.c_int()
        wx, wy = ctypes.c_int(), ctypes.c_int()
        mask = ctypes.c_uint()
        ok = self.x11.XQueryPointer(
            self.d, self.root, ctypes.byref(root_ret), ctypes.byref(child_ret),
            ctypes.byref(rx), ctypes.byref(ry), ctypes.byref(wx), ctypes.byref(wy),
            ctypes.byref(mask),
        )
        return (rx.value, ry.value, child_ret.value) if ok else None

    def _aim(self, x: int, y: int) -> bool:
        """Warp to window-relative (x, y) and confirm X agrees we got there.

        XWayland mirrors the *physical* pointer, so a real mouse movement
        anywhere between our warp and our click puts the cursor somewhere
        else -- and the click silently lands in another window (or nowhere
        interesting), which reads as "the app ignores my input". Re-warp a
        few times; if the hand still wins, say so loudly instead of letting
        the caller debug a click that never arrived.
        """
        ax, ay = self.origin()
        want = (ax + x, ay + y)
        for _ in range(6):
            self.x11.XWarpPointer(self.d, 0, self.win, 0, 0, 0, 0, x, y)
            self.x11.XFlush(self.d)
            here = self.pointer()
            if here and (here[0], here[1]) == want:
                return True
        print(f"  WARNING: pointer at {self.pointer()[:2] if self.pointer() else '?'} "
              f"after warping to window-relative ({x},{y}); the physical mouse "
              f"keeps moving it -- the next event may miss the app", flush=True)
        return False

    def click(self, x: int, y: int, button: int = 1):
        """Click at window-relative pixels (0,0 is the top-left corner)."""
        self._aim(x, y)
        self.xtst.XTestFakeButtonEvent(self.d, button, 1, 0)
        self.xtst.XTestFakeButtonEvent(self.d, button, 0, 0)
        self.x11.XFlush(self.d)
        time.sleep(0.2)

    def warp(self, x: int, y: int):
        """Move the pointer to window-relative pixels without clicking.

        Uses XWarpPointer (what `click` uses) with position verification:
        `xdotool mousemove` silently does nothing on this display, which makes
        hover tests lie about where the pointer is.
        """
        self._aim(x, y)

    # -- capture -----------------------------------------------------------
    def size(self):
        scr, x, y = ctypes.c_ulong(), ctypes.c_int(), ctypes.c_int()
        w, h, border, depth = (ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint())
        self.x11.XGetGeometry(
            self.d, self.win, ctypes.byref(scr), ctypes.byref(x), ctypes.byref(y),
            ctypes.byref(w), ctypes.byref(h), ctypes.byref(border), ctypes.byref(depth),
        )
        return w.value, h.value

    def origin(self):
        """Window position in root coordinates (XGetGeometry's x/y are parent-relative)."""
        dest = ctypes.c_int(), ctypes.c_int()
        self.x11.XTranslateCoordinates(
            self.d, self.win, self.root, 0, 0,
            ctypes.byref(dest[0]), ctypes.byref(dest[1]), ctypes.byref(ctypes.c_ulong()),
        )
        return dest[0].value, dest[1].value

    def root_shot_window(self, path: str):
        """Root-grab exactly the app window's rectangle (sees popups over it)."""
        x, y = self.origin()
        w, h = self.size()
        return self.root_shot(path, geom=(w, h, x, y))

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


def _is_int(token: str) -> bool:
    try:
        int(token)
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
        elif op == "type":
            app.type_text(ops[i])
            i += 1
        elif op == "click":
            x, y = int(ops[i]), int(ops[i + 1])
            i += 2
            button = 1
            if i < len(ops) and ops[i] in ("1", "2", "3"):
                button = int(ops[i])
                i += 1
            app.click(x, y, button)
        elif op == "warp":
            app.warp(int(ops[i]), int(ops[i + 1]))
            i += 2
        elif op == "pointer":
            here = app.pointer()
            where = f"root={here[:2]} over=0x{here[2]:x}" if here else "unknown"
            print(f"  pointer: {where}")
        elif op == "shot":
            app.capture(ops[i], force_repaint=force_repaint)
            i += 1
        elif op == "rootshot":
            path = ops[i]
            i += 1
            if i < len(ops) and ops[i] == "window":
                i += 1
                app.root_shot_window(path)
            elif i + 3 < len(ops) and all(_is_int(ops[i + k]) for k in range(4)):
                w, h, x, y = (int(ops[i + k]) for k in range(4))
                i += 4
                app.root_shot(path, geom=(w, h, x, y))
            else:
                app.root_shot(path)
        elif op == "wins":
            app.wins()
        elif op == "popup":
            app.shot_child(ops[i])
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
