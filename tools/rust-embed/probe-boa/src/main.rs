//! boa — a pure-Rust JS engine, so no C toolchain and no V8 download.
//!
//! Caveat found while testing: boa 0.22 omits `String.prototype.substr`
//! (an Annex B method). The bundle calls it in exactly 2 places, and exactly
//! 3 of the 206 types fail without it: `pyrm`, `mpyr`, `333noob` — all with
//! `TypeError: not a callable function`. `probe_common::SHIM` installs a
//! guarded polyfill; delete it and the sweep reports `203/206`.
//!
//! Also the slowest engine tested (~49x Node on the full sweep; `mgmso`
//! alone took 107 s). Correct, but not a fit for a timer UI.
//!
//! Run: `cargo run --release -p probe-boa`

use boa_engine::{Context, Source};
use probe_common::{bundle_path, print_report, split_output, sweep_expr, types_json, SHIM};
use std::time::Instant;

fn main() {
    let bundle = std::fs::read_to_string(bundle_path()).expect("read bundle");
    let sweep = sweep_expr(&types_json());

    let mut ctx = Context::default();

    if let Err(e) = ctx.eval(Source::from_bytes(SHIM)) {
        println!("SHIM FAILED: {e}");
        return;
    }

    let t0 = Instant::now();
    if let Err(e) = ctx.eval(Source::from_bytes(bundle.as_str())) {
        println!("[boa] EVAL FAILED: {e}");
        return;
    }
    println!("[boa] bundle evaluated OK in {:?}", t0.elapsed());

    match ctx.eval(Source::from_bytes(sweep.as_str())) {
        Ok(v) => {
            let out = v
                .to_string(&mut ctx)
                .map(|t| t.to_std_string_lossy())
                .unwrap_or_default();
            let (dump, counts) = split_output(&out);
            print_report(&dump, &counts);
        }
        Err(e) => println!("[boa] SWEEP FAILED: {e}"),
    }
}
