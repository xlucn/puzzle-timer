//! libnode via `edon` — embeds a *real* Node.js, so `require('cstimer_module')`
//! works with no shim at all (the bundle's own `isInNode` test passes).
//!
//! Recommended when you want genuine Node semantics. Caveats found in testing:
//!   - You must supply `libnode.so` yourself; Node ships no embeddable library
//!     by default. Prebuilts: `alshdavid-labs/libnode-prebuilt` or
//!     `metacall/libnode` — **note metacall v26.x has no linux-amd64 asset**
//!     (the amd64 build fails; only arm64/windows/macos are published), and
//!     the old `alshdavid/libnode-prebuilt` org 404s — it is now
//!     `alshdavid-labs`. It is ~143 MB uncompressed.
//!   - `eval_blocking` resolves `()` and cannot return a value, so the sweep
//!     hands its result to `fs.writeFileSync` instead.
//!   - `edon` is 0.0.x (MIT) — treat as a prototype dependency.
//!
//! Run:
//!   LIBNODE=/path/to/libnode.so cargo run --release -p probe-libnode

use edon::Nodejs;
use probe_common::{bundle_path, print_report, split_output, sweep_to_file_expr, types_json};
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    let libnode = std::env::var("LIBNODE").unwrap_or_else(|_| {
        panic!("set LIBNODE=/path/to/libnode.so (see the module docs for prebuilt sources)")
    });
    let out_file: PathBuf = std::env::var("OUT_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join("cstimer_embed_sweep.txt"));

    let bundle = std::fs::read_to_string(bundle_path()).expect("read bundle");
    let types = types_json();
    let out_str = out_file.to_string_lossy().into_owned();

    // Real Node: the bundle needs no shim, but the language strings still must
    // be on the global object — `333noob` reads them and, if they are missing,
    // throws and desyncs the shared RNG for every later type.
    let lang = r#"
      globalThis.SCRAMBLE_NOOBST = [
        ['turn the top face', 'turn the bottom face'],
        ['turn the right face', 'turn the left face'],
        ['turn the front face', 'turn the back face']
      ];
      globalThis.SCRAMBLE_NOOBSS =
        ' clockwise by 90 degrees,| counterclockwise by 90 degrees,| by 180 degrees,';
    "#;

    let t0 = Instant::now();
    let nodejs = match Nodejs::load_default(&libnode) {
        Ok(n) => n,
        Err(e) => {
            println!("[edon] FAILED to load libnode: {e}");
            return;
        }
    };
    println!("[edon] libnode loaded in {:?}", t0.elapsed());

    // Stage 1: define the bundle + lang globals via require(), stashing the
    // exports on globalThis for stage 2 (each eval is a separate script).
    let setup = format!(
        "{lang}\n{bundle}\nglobalThis.__ct = module.exports;\n"
    );
    let t0 = Instant::now();
    if let Err(e) = nodejs.eval_blocking(setup) {
        println!("[edon] setup FAILED: {e}");
        return;
    }
    println!("[edon] bundle required() in {:?}", t0.elapsed());

    // Stage 2: point the bundle's own `module.exports` back at the stashed
    // exports (each eval is a separate script), then run the sweep and hand
    // its result to fs.writeFileSync — eval_blocking can't return a value.
    let runner = format!(
        "globalThis.module.exports = globalThis.__ct;\n{}",
        sweep_to_file_expr(&types, &out_str)
    );
    let t0 = Instant::now();
    match nodejs.eval_blocking(runner) {
        Ok(_) => println!("[edon] sweep written in {:?}", t0.elapsed()),
        Err(e) => {
            println!("[edon] sweep FAILED: {e}");
            return;
        }
    }

    match std::fs::read_to_string(&out_file) {
        Ok(text) => {
            let (dump, counts) = split_output(&text);
            print_report(&dump, &counts);
        }
        Err(e) => println!("[edon] no output file: {e}"),
    }
}
