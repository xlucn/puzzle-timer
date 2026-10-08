# Rust: embedding `cstimer_module` vs. porting it

> **Status: research only.** Written 2026-10-07/08, at the user's request, so
> the findings survive until the day they're needed. Nothing here is scheduled —
> the milestone order in [PLAN.md](./PLAN.md) §1 is unchanged. A Rust port is
> **not** M16 and must not be started unprompted.
>
> **Re-run the evidence:** `tools/rust-embed/run.sh` (see [§7](#7-reproducing-this)).

## 1. The question, and the short answer

The stack decision in PLAN.md §2 rejected *"Python + PyGObject / Rust"* with the
reason *"awkward fit for the JS scramble module"*. Two questions follow:

1. **Can a Rust app run `cstimer_module` without porting it?** — embed a JS engine.
2. **If not, how hard is porting the dependency itself?**

**Answers, both measured:**

1. **Yes, easily.** Five engines were tested end-to-end. Every one of them runs
   the real bundle and produces **byte-identical output for all 206 scramble
   types**. The host shim is ~10 lines of JavaScript. The recommended engine is
   the **`v8` crate (rusty_v8) used directly** — 8 crates in the dependency
   graph, no tokio, Node-class speed (§5).
2. **Hard-ish, ~19k lines**, with 4k of it machine-transpiled from Java and
   ~600 sites where JS integer semantics must be reproduced exactly to keep
   seed parity. Doable, but it is weeks of work against a few hours for option 1.

**Recommendation: embed, don't port.** Reserve porting for the case where
shipping a JS engine is itself unacceptable (§6).

A second, independent argument for Rust is the binding quality: `gtk4-rs` is at
0.11.5 (2026-09-20) and `libadwaita` at 0.9.2 (2026-07-07), both under the
actively-maintained [gtk-rs](https://gtk-rs.org) project (~2.3k stars, gtk4-rs
0.11.4 released 2026-06-29 with 129 commits since). `node-gtk`, by contrast, is
a single-maintainer binding — PLAN.md §5 already lists that as the project's
main architectural risk. So a future Rust rewrite buys better GUI bindings
*and* can keep the scramble module untouched.

---

## 2. The five engines, tested

Each probe loads the real `node_modules/cstimer_module/cstimer_module.js`,
drives all 206 types with the app's own default lengths (`src/core/scrambleTypes.ts`),
seeds with `setSeed('42')`, calls `getImage` between scrambles to keep the RNG
stream aligned with Node, and dumps `id<TAB>json-string` per type.

| engine | crate | version tested | verdict |
|---|---|---|---|
| **V8** direct | `v8` (rusty_v8) | 150.4.0 | ✅ **recommended** — Node-class speed, 8-crate graph, no tokio |
| **V8** via `deno_core` | `deno_core` | 0.412 | ✅ works — same speed, richer API, but 322 crates + tokio |
| **Node.js** via libnode | `edon` | 0.0.27 | ✅ works — truest semantics, but you ship a 143 MB `.so` |
| **QuickJS** | `rquickjs` | 0.14 | ⚠️ correct, ~23× slower — fine for 3×3, not for 4×4+ |
| **boa** | `boa_engine` | 0.22 | ❌ correct *after a polyfill*, ~49× slower |

### Correctness — all five identical to Node

```
=== diff vs node ===
  quickjs    IDENTICAL (all 206 types byte-for-byte)
  boa        IDENTICAL (all 206 types byte-for-byte)
  deno       IDENTICAL (all 206 types byte-for-byte)
  v8         IDENTICAL (all 206 types byte-for-byte)
  libnode    IDENTICAL (all 206 types byte-for-byte)

engines identical: 4   problems: 0     # 5 with LIBNODE set
```

Every dump hashes to the same value as Node's:

```
7750f9e8e1eaf18540c43a8ec7f6d574  (206 lines, all five engines + node)
```

and all report `generated OK=206 empty=0 images=177 failures=0 total=206`.

**This is the headline finding.** The ISAAC seed path is exact integer math, so
seed parity survives the engine boundary completely — including the shared RNG
stream across 206 sequential calls.

---

## 3. The host shim (the entire porting surface)

The bundle is Closure-compiled ES5: no `eval`, no `with`, no `async`/`await`,
no `Promise`, no DOM in the worker path, no `Proxy`. It needs a Node-ish global:

```js
(function(){
  var g = globalThis;
  g.global = g;                              // part of isInNode test
  g.process = {};                            // part of isInNode test
  g.require = function(){ return {}; };      // part of isInNode test
  g.module = { exports: {} };                // where exports land
  g.console = { log: function(){}, warn: function(){}, error: function(){} };

  g.SCRAMBLE_NOOBST = [ /* ... */ ];         // csTimer lang strings,
  g.SCRAMBLE_NOOBSS  = '...';                //   not bundled by the module

  if (!String.prototype.substr) { /* boa only — see §5 */ }
  return 'shim-ok';
})()
```

### Why exactly those three globals

csTimer's `lib/utillib.js` computes:

```js
const isInNode = (typeof process === 'object' && typeof require === 'function'
                  && typeof global === 'object');
const isInWorker = (...WorkerGlobalScope...) || isInNode;
```

and `execBoth()` runs the worker branch **only** when `isInWorker` is true. That
branch is what installs `module.exports`, `self.$` and `self.kernel`. No shim,
no exports. Fake those three globals and the whole bundle comes up.

Under real libnode, `process`/`require`/`global` genuinely exist — **no shim at all**.

### The two traps that cost me the most time

1. **`SCRAMBLE_NOOBST` / `SCRAMBLE_NOOBSS` are not in the module.** csTimer
   ships them in `src/lang/*.js`; `cstimer_module` bundles only the scramblers.
   Without them `333noob` throws — **and because the seeded RNG is shared and
   sequential, the throw desyncs the stream so every subsequent type differs.**
   My first Node reference had this bug: it produced a 206-line dump that looked
   plausible but diverged from every engine from type #21 onward. If your
   reference output disagrees everywhere past a certain point, suspect a missing
   lang string (or an uncaught throw) rather than an engine bug.
   The app already handles this — `src/scramble/cstimerLang.ts`.

2. **`getImage` returns `false`, not `null`,** for the 28 types with no drawing
   rule. Bind it as a union (`bool | string`) or as "truthy string", never as
   `Option<String>` — a `None`-only binding fails on the first imageless type.

---

## 4. Performance (measured, this machine)

### Full 206-type sweep, wall clock

Measured twice (initial research run, then the committed harness) — expect
±20% run-to-run variance, the ordering never changed:

| engine | sweep | vs node |
|---|---|---|
| **node 26.10** (baseline) | **7.5 – 8.4 s** | 1× |
| **rusty_v8 direct** | **8.9 – 9.1 s** | ~1× |
| **deno_core (V8)** | **8.0 – 9.1 s** | ~1× |
| **rquickjs (QuickJS)** | **187 – 192 s** | ~24× |
| **boa** | **415 – 526 s** | ~55× |

The two V8 rows are the same engine on the same machine; their ranges overlap,
so the difference between them is noise, not a deno_core overhead. Slowest
types are always the random-state ones: `mgmso`, `444wca`, `ftoso`,
`444bld`, `444ud3c`.

### Per-type, first call (builds pruning tables) / warm call

| type | node | deno_core | rquickjs | boa |
|---|---|---|---|---|
| `333` | 47 / 7 ms | 6 / 13 ms | 1127 / 544 ms | 2310 / 1441 ms |
| `222so` | 11 / 4 ms | 1 / 1 ms | 111 / 10 ms | 294 / 45 ms |
| **`444wca`** | **1209 / 81 ms** | **563 / 131 ms** | **61 590 / 3520 ms** | **125 040 / 7625 ms** |
| `sqrs` | 54 / 32 ms | 17 / 35 ms | 1124 / 826 ms | 2485 / 1569 ms |
| `clkwca` | 0 / 0 ms | 0 / 0 ms | 0.3 / 0.02 ms | 0.65 / 0.08 ms |

`deno_core`'s numbers are **the same class as Node** — occasionally faster, since
it skips `worker_threads` and the structured clone. `v8` direct is the same
engine and tracks it within noise (both engines swept in 8.0 – 9.1 s).

**Against this project's own budget:** AGENTS.md rule 4 exists because *"a 4×4
WCA scramble takes ~1.2 s and would freeze the UI"*. QuickJS's **warm** 4×4 is
3.5 s — already 3× over budget — and boa's is 7.6 s, with `mgmso` at 107 s.
So for *this* app only a V8-backed crate (`v8` or `deno_core`) or libnode
qualify. QuickJS/boa would be acceptable only for a non-interactive tool.

### Why Python was ruled out early

An ISAAC-style integer loop, same machine:

| runtime | throughput |
|---|---|
| node | 600.9 Miter/s |
| rustc -O | 624.9 Miter/s |
| **python3** | **3.1 Miter/s** |

~190× slower than Node. Extrapolated to the real workload, a 4×4 scramble goes
from 1.2 s to **minutes**. CPython is not viable without a C extension, which
defeats the point. (PyPy/numba were not tested; neither integrates with GTK
bindings usefully.)

---

## 5. Engine-by-engine notes

### `v8` (rusty_v8) direct — recommended

```toml
v8 = "150"
```

The `v8` crate on crates.io **is** rusty_v8 — Deno's own name for it. It is
`deno_core`'s substrate, not a competitor: deno_core adds an *op system*
(Rust↔JS FFI), an *event loop* mapping JS Promises onto Rust Futures, a module
loader, and startup snapshots. (The CLI is a separate crate, `deno_cli`.)

**None of that is needed here**, and dropping it is a real win:

| | `v8` direct | `deno_core` |
|---|---|---|
| crates in the graph | **8** | 322 |
| tokio required | **no** | yes |
| stripped binary | **44.3 MB** | 48.2 MB |
| sweep | 8.9 – 9.1 s | 8.0 – 9.1 s |
| our code | 99 lines | 47 lines |

The bundle is a synchronous ES5 script: no Promises, no dynamic `import`, no
ops. So the runtime is platform init → one `Isolate` → one `Context` → three
`Script::compile` + `run`. That also **removes deno_core's tokio requirement**
— that requirement was deno_core's own delayed-task plumbing, not V8's (V8's
`new_default_platform` runs its tasks on its own pool).

- **MIT**, V8 statically linked — the 44 MB binary depends on libc only
  (`ldd` shows 5 system libs, no `libv8.so`).
- Same first-build download of the prebuilt `librusty_v8.a` (~178 MB). Use the
  proxy if it stalls: `http_proxy=http://localhost:1080`.
- **Gotcha 1 — scopes are the whole API.** Everything wants `&mut v8::PinScope`;
  create it with `v8::scope!(let scope, isolate)` and, inside, capture
  exceptions with `v8::tc_scope!(let tc, scope)`. Both macros pin + init for
  you — hand-rolling `TryCatch::new(...)` does *not* work, and the type
  signatures are what you'll fight first.
- **Gotcha 2 — `String::new` returns `Option`.** `None` means the source is too
  long for V8's string limit; unwrap with a message rather than `unwrap()`.
- **Gotcha 3 — results come back as `v8::Value`.** For our sweep,
  `value.to_rust_string_lossy(scope)` is enough. `serde_v8` exists precisely to
  skip this, so if you need structured values, deno_core is the better trade.
- **Gotcha 4 — no teardown in the probe.** A long-lived app must
  `v8::V8::dispose()` / `dispose_platform()`; the probe skips it deliberately
  to keep the happy path free of `unsafe`.
- No Node built-ins (`fs`, `path`, `crypto`) — the bundle's optional
  `crypto.getRandomValues` is skipped, so **always call `setSeed` explicitly**
  (the app already does).

**Choose `deno_core` instead when** you want ops (Rust functions callable from
JS), Promise/async support, ES module loading, or startup snapshots — i.e. when
you're building a general JS runtime rather than calling three synchronous
functions. Our earlier recommendation of deno_core was made before testing
`v8` direct; on these numbers the leaner crate wins for this workload.

### `deno_core` — the same V8, with an event loop on top

```toml
deno_core = "0.412"
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
```

- **MIT**, V8 **statically linked** — the 48 MB binary depends only on libc
  (`ldd` shows 5 system libs, no `libv8.so`).
- First build downloads a prebuilt `librusty_v8.a` (~178 MB build artifact).
  Needs the proxy if the network stalls: `http_proxy=http://localhost:1080`.
- **Gotcha 1 — tokio is mandatory.** Creating a `JsRuntime` outside a tokio
  context aborts the process:
  `V8 posted a delayed task, but this isolate was created outside of a tokio runtime context`.
  Fix: `#[tokio::main]` on `main`.
- **Gotcha 2 — `execute_script` takes owned `String`.** Only `ascii_str!`
  literals may borrow; `&str` from a file read does not compile.
- **Gotcha 3 — reading a result.** `execute_script` returns
  `v8::Global<v8::Value>`; read it inside `deno_core::scope!(scope, rt)` then
  `serde_v8::from_v8::<String>(scope, local)`.
- No Node built-ins (`fs`, `path`, `crypto`) — you don't need them here, but
  the bundle's optional `crypto.getRandomValues` is skipped, so **always call
  `setSeed` explicitly** (the app already does).

### `edon` + libnode — truest, heaviest

- Runs a **real Node.js**: `require('cstimer_module')` works, no shim needed.
  Verified against node v24.5.0 / V8 13.6.233.10.
- **You must supply `libnode.so` yourself — ~143 MB**, and Node publishes no
  official embeddable library. Sources (checked 2026-10-08):
  - `alshdavid-labs/libnode-prebuilt` ✅ (`v24.5.0`, `v22.18.0` linux-amd64).
    Note the org rename: the old `alshdavid/libnode-prebuilt` URL **404s**.
  - `metacall/libnode` — **v26.x has no linux-amd64 asset** (the amd64-linux
    build fails; only arm64/windows/macos publish). Don't plan around it.
- **Gotcha — `eval_blocking` cannot return a value** (resolves `()`). Hand
  results out via `fs.writeFileSync`, as `probe-libnode` does.
- `edon` is `0.0.27`, MIT, 8% docs. Treat as a prototype dependency, and its
  maintainer's own README says static linking of libnode has failed so far.
- Licensing note: Node is MIT *with* its bundled deps; verify before shipping.

### `rquickjs` — smallest, but slow

- **1.8 MB** stripped binary; MIT; QuickJS compiles in ~2.5 min, no downloads.
- Correct on all 206 types, but 4×4 warm is 3.5 s (23× Node) and `mgmso` 29 s.
- **Gotcha:** the shim returns `'shim-ok'` (a string) — `eval::<bool, _>` fails
  with `Error converting from js 'string' into type 'bool'`. Match the type.

### `boa` — pure Rust, but missing `substr`

- **12.5 MB** stripped; `Unlicense OR MIT`; no C toolchain, no downloads.
- **`boa_engine` 0.22 does not implement `String.prototype.substr`** — an
  Annex B (non-standard) method. The bundle calls it in exactly 2 places, and
  **exactly 3 of 206 types fail**: `pyrm`, `mpyr`, `333noob`, all with
  `TypeError: not a callable function`. The stack points at the call site:

  ```
  pyrm THREW TypeError: not a callable function
      stack: at F (...:435:427) | at <main> (...:446:461) | at apply (native)
  ```
  where `F` is `addPyrTips` — `return P.substr(0, P.length - moveLen*cnt) + ...`.

  Confirmed directly: `typeof ''.substr` is `"undefined"` under boa, `"function"`
  under Node. The shared shim installs a 6-line guarded polyfill, after which
  boa reports `206/206, failures=0`.
- **Slowest engine tested** — 49× Node on the sweep; `mgmso` alone took 107 s.
- Lesson: engine conformance gaps are **silent and type-specific**. Only a full
  206-type sweep catches them; a 10-type smoke test would have missed all three.

---

## 6. If you do port instead

The unminified source is csTimer's `src/js/`, which lives at
`/home/oliver/Code/clones/cstimer-master` (rev `2547d82`, 2026-08-07). The exact
file list the module is built from is Makefile's **`moduleSrc`** target.

### Scale

| | lines |
|---|---|
| `moduleSrc` (33 files) | **19 760** |
| minus `ISCSTIMER`-guarded UI blocks (measured: `scramble.js` 193–954, `tools/cross.js` 453–504, `tools/image.js` 1058–1073) | −827 |
| **real port surface** | **≈18 900** |
| — of which GWT-transpiled Java | 3 992 |

Biggest files: `scramble_444.js` 3084, `mathlib.js` 1502, `min2phase.js` 1399,
`scramble_333_edit.js` 1179, `poly3dlib.js` 1120, `tools/image.js` 1084,
`solver/megaminx.js` 1050, `grouplib.js` 1001.

### The four things that actually make it hard

**(a) ~4 000 lines are machine-transpiled from Java.**
`scramble_444.js` and `scramble_sq1_new.js` are GWT-style output: `$clinit`
static initializers that self-null (`Shape_$clinit = $.noop`), `defineClass()`
with `arguments`-based inheritance, `nullMethod`, `createArray(length1, length2)`,
`_`-aliased prototypes. You would be transliterating *generated* Java semantics
— static-init ordering, Java `int` wraparound — from code nobody maintains by
hand. Highest-leverage move: hunt down the original Java sources first.

**(b) ~600 integer-semantics sites.** Counts over the 33 files:

| idiom | count | Rust trap |
|---|---|---|
| `~~` (ToInt32 truncate) | 254 | `as i32` *saturates*; `~~` wraps |
| `>>` (signed, int32) | 355 | must coerce to `i32` first |
| `<<` | 300 | Rust **panics** if shift ≥ width |
| `>>>` (logical) | 28 | needs `u32` |
| `%` | 401 | Rust matches JS (sign of dividend) — Python does **not** |

Concrete hazards, all commented by the author who was already fighting this:

```js
// lib/min2phase.js:123 — relies on JS masking the shift count to 5 bits
table[index >> 3] ^= value << (index << 2);  // index << 2 <=> (index & 7) << 2
// lib/mathlib.js:436 — silent int32 wraparound
ret = 0 | (ret * 31 + (i < 12 ? this.ea[i] : this.ca[i - 12]));
// scramble/scramble_333_edit.js:129 — 48-bit mask, forces "/" over ">>"
var val = arr & 0xf; // should use "/" instead of ">>" to avoid unexpected type conversion
```

`getAnyScramble` takes `0xffffffffffff` (48-bit) masks → needs `u64`, not `i32`.
Rust debug builds panic on overflow where JS silently wraps, so arithmetic needs
`wrapping_*` throughout — or you get failures that only appear in debug.

**(c) Prototype OO + dynamic dispatch.** 130 `X.prototype.f =` assignments
across 21 classes (`CubieCube`, `SchreierSims`, `Search`, `SubgroupSolver`,
`FtoSolver`, `MgmCubie`, `PolyScrambler`, …), plus 69 `.bind(`, 21 `.apply(`,
15 `arguments`, 49 object-`in` checks, 18 `for…in`. Mechanical in Rust, but it
is where most of the labour goes. Note `getScrambleTypes()` order comes from
`for…in`, where JS puts integer-like keys first (`111, 112, …, 111111, blank,
333o, …`) — a Rust `HashMap` would return a different order. Use `IndexMap`.

**(d) String-as-byte-array hashing.** `String.fromCharCode.apply(null, perm)`
as map keys (8 sites: `grouplib.js:445,551`, FTO phase hashes) plus
`seedStr.charCodeAt(i)` for seeding. Easy as `Vec<u8>` keys and
`encode_utf16()` for seeds — but must be *bit-exact* for `setSeed("42")` to
match the JS module.

### What is *not* hard

- **No JS magic**: zero `eval`/`with`/`new Function`/`Proxy`/`Symbol` traps in
  the module path. Ordinary array + integer code.
- **SVG images (~2 200 lines)** are pure string building — no canvas, no DOM.
  `poly3dlib.js` has 75 `Math.sin/cos` calls, so the SVG won't be byte-identical
  across languages; compare structurally, never as golden strings.
- **~80 of the 206 types** are plain random-move string generators
  (`utilscramble.js`, `megascramble.js`) — an afternoon's work.
- **GPL-3.0 permits it.** The port stays GPL-3.0-or-later, which the project
  already is.

### Seed-parity caveat for any implementation (JS or Rust)

Measured over all 206 types with two seeds each:

| behaviour | count | types |
|---|---|---|
| seed-deterministic **and** seed-sensitive | **197** | — |
| seed ignored (constants) | 2 | `blank`, `lol` |
| **call-history dependent** | **6** | `15prp`, `15prap`, `15prmp`, `8prp`, `8prap`, `8prmp` |
| throws without lang strings | 1 | `333noob` |

The 6 slider types are the interesting ones: `gSolver.searchNext` remembers
`prevSolStr` and *deliberately* returns a different solution than last time
(`lib/mathlib.js`). Same seed, second call in the same process → different
scramble. This is not a bug to fix but a behaviour to preserve (or consciously
change) — and a differential test harness must whitelist them.

---

## 7. Reproducing this

All evidence is regenerable from the repo:

```bash
# regenerate the 206-type list from the app's own catalogue
node --import tsx tools/rust-embed/gen-types.mjs

# build + run node, quickjs, boa, deno; diff every dump against node
tools/rust-embed/run.sh

# optional: the libnode route (needs a downloaded libnode.so)
LIBNODE=/path/to/libnode.so tools/rust-embed/run.sh
```

Layout:

```
tools/rust-embed/
├── Cargo.toml              workspace (5 members)
├── run.sh                  builds, sweeps, diffs, prints a verdict
├── gen-types.mjs           types.json ← src/core/scrambleTypes.ts
├── types.json              206 × {id, len} (generated)
├── node-reference.cjs      the reference dump (real Node + real require)
├── probe-common/src/lib.rs shim, sweep script, path resolution
├── probe-quickjs/          rquickjs
├── probe-boa/              boa (+ documents the substr gap)
├── probe-deno/             deno_core (+ tokio gotcha)
├── probe-v8/               v8 direct — no deno_core, no tokio
└── probe-libnode/          edon/libnode (LIBNODE= required)
```

Expected: `engines identical: 4   problems: 0` (5 with `LIBNODE` set), all
dumps `7750f9e8e1eaf18540c43a8ec7f6d574`, every engine reporting
`generated OK=206 empty=0 images=177 failures=0 total=206`.

Verified 2026-10-08: node / quickjs / boa / deno / v8 all byte-identical.
Don't run two slow probes concurrently — they contend and one may be killed
mid-sweep.

The harness is a probe, not a dependency — `tools/rust-embed/target/` is
gitignored (2 GB), and nothing here ships with the app.

---

## 8. What a Rust rewrite would touch in *this* app

Separate from the dependency question, if the whole app moves to gtk4-rs
(line counts measured 2026-10-08):

| area | non-test lines | notes |
|---|---|---|
| `src/ui/` | 2 744 | rewrite against `gtk4` 0.11 / `libadwaita` 0.9 — see Blueprint below |
| `src/core/` | 2 152 | **portable as-is in spirit** — pure TS, no `gi:*`, 2 053 test lines |
| root-level | 1 204 | `main.ts` etc. |
| `src/platform/` | 625 | store + CSPRNG; 423 test lines |
| `src/scramble/` | 318 | **this is the boundary** — protocol/service/worker |
| **total** | **7 043** | + 2 476 test lines |

`src/scramble/` is deliberately thin: a one-request/one-reply queue over
plain data (`protocol.ts`, 33 lines). Swapping the Node worker for an embedded
engine touches **only that directory** — `core/`, `ui/` and `platform/` would
not notice. That boundary was drawn for the GJS option (PLAN.md §3) and it does
the same job here.

**Rule 4 survives either way.** A 4×4 scramble takes ~1.2 s; whatever engine
produces it must stay off the UI thread (a `v8` `Isolate` on a worker thread,
or the existing `worker_threads` shape reimplemented with a Rust thread +
channel).

### Blueprint (`.blp`) — free win in a rewrite, not worth it now

[Blueprint](https://gitlab.gnome.org/exalm/blueprint) is GNOME's declarative
markup for GTK4 widget trees; `blueprint-compiler` compiles `.blp` to the
`.ui` GtkBuilder XML GTK already consumes. It matters here because
`gtk4::CompositeTemplate` accepts it **directly** — `#[template(file = "…blp")]`
or an inline `string`, needing only `blueprint-compiler` on `PATH` at build
time (gtk-rs release notes, 2023-08-28). So a rewrite gets:

- **Typed children and callbacks.** `[Child]` becomes a `#[template_child]`
  field, `clicked => on_click()` becomes a `#[template_callback]` method —
  both checked against the `.blp` at compile time, not at runtime.
- **Errors move to build time.** A misspelled property or signal is a
  `blueprint-compiler` error instead of a GTK stderr warning you scroll past.
  Today the equivalent typo surfaces only when the widget is constructed.

**Why it isn't worth it in this codebase:** templates require GObject
subclassing, and subclassing is precisely what AGENTS.md rule 5 tells this
project to avoid — the risk is node-gtk's FFI, not GObject itself. Strip that
constraint and the calculus flips: the subclassing behind `[Child]`/
`[Callback]` becomes ordinary memory-safe Rust through `glib::subclass`.

**How much would actually move:** of `src/ui/`'s 1 453 substantive lines
(non-blank, non-comment), **344 — about 24% — sit inside `new Gtk.*`/`new
Adw.*` construction blocks** across 76 sites, which is what a `.blp` tree
replaces. The rest does not move:

| stays in Rust | why |
|---|---|
| layout tiers / breakpoints | Blueprint has no conditionals or loops — the three-tier adaptive logic is code |
| `Gtk.ColumnView` model + factories | data-driven; Blueprint can only declare the widget |
| signal handlers, timers, undo paths | behaviour |
| `gi:*` property readback | Blueprint writes properties; it doesn't read them back |

So: roughly a quarter of `ui/` gets shorter and better-checked, and the
hard parts (the adaptive layout, the focus chains AGENTS.md anchors document)
stay where they are. Real, but modest.

**Costs:** a `blueprint-compiler` build dependency (Python — goes in the
M15 PKGBUILD's `makedepends`), a two-file navigation for every widget tree,
and no hot-reload equivalent to `npm run dev`'s CSS reload. The AGENTS.md
rules about adaptive widgets still apply unchanged — Blueprint draws the tree;
it does not stop you reimplementing `Adw.Breakpoint` by hand.

**Verdict:** adopt `.blp` for the static shell *if and when* a gtk4-rs rewrite
happens; don't retrofit it into the node-gtk app.

---

## 9. Open questions for the day it happens

1. **Why port at all?** Only plausible triggers: dropping Node from the runtime
   dependencies (AUR/M15 packaging), or `node-gtk` becoming unmaintainable.
   If the trigger is the latter, embedding keeps `core/` and `scramble/` and
   rewrites only `ui/` — strictly less work than a full port.
2. **Which engine?** `v8` direct on today's evidence (8 crates, no tokio);
   `deno_core` if you later want ops, Promises or ES modules. Re-measure — V8's
   download is the main build-time risk, and `boa` may have gained `substr`.
3. **Do you need seed parity with the JS version at all?** If not, the hardest
   600 sites in §6(b) become ordinary (if slower) work.
4. **Licence review** before shipping: `cstimer_module` is GPL-3.0; `edon`'s
   libnode bundle needs a dependency-level check.
5. **Python stays rejected** unless someone measures a JIT strategy that
   integrates with GTK bindings.
