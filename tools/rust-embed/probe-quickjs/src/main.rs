//! QuickJS via `rquickjs` — smallest engine tested (1.8 MB stripped binary),
//! but ~23x slower than Node on the full sweep. MIT.
//!
//! Run: `cargo run --release -p probe-quickjs`

use probe_common::{bundle_path, print_report, split_output, sweep_expr, types_json, SHIM};
use rquickjs::{Context, Runtime};
use std::time::Instant;

fn main() {
    let bundle = std::fs::read_to_string(bundle_path()).expect("read bundle");
    let sweep = sweep_expr(&types_json());

    let rt = Runtime::new().unwrap();
    let ctx = Context::full(&rt).unwrap();

    ctx.with(|ctx| {
        if let Err(e) = ctx.eval::<String, _>(SHIM) {
            println!("SHIM FAILED: {e}");
            return;
        }

        let t0 = Instant::now();
        match ctx.eval::<(), _>(bundle.as_bytes()) {
            Ok(_) => println!("[quickjs] bundle evaluated OK in {:?}", t0.elapsed()),
            Err(e) => {
                println!("[quickjs] EVAL FAILED: {e}");
                return;
            }
        }

        match ctx.eval::<String, _>(sweep.as_bytes()) {
            Ok(out) => {
                let (dump, counts) = split_output(&out);
                print_report(&dump, &counts);
            }
            Err(e) => println!("[quickjs] SWEEP FAILED: {e}"),
        }
    });
}
