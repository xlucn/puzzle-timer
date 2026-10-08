//! deno_core (V8) — the recommended engine: node-class speed, MIT, and V8 is
//! statically linked, so the binary has no runtime dependency beyond libc.
//!
//! Two API notes:
//!   - `JsRuntime` must be created inside a tokio runtime context, otherwise
//!     V8 aborts with "V8 posted a delayed task, but this isolate was created
//!     outside of a tokio runtime context". Hence `#[tokio::main]`.
//!   - `execute_script` takes an owned `String` (only `ascii_str!` literals
//!     may borrow), and the result comes back as `v8::Global<v8::Value>` that
//!     must be read inside `deno_core::scope!`.
//!
//! Run: `cargo run --release -p probe-deno`

use deno_core::{v8, JsRuntime, RuntimeOptions, serde_v8};
use probe_common::{bundle_path, print_report, split_output, sweep_expr, types_json, SHIM};
use std::time::Instant;

fn eval_string(rt: &mut JsRuntime, name: &str, src: &str) -> String {
    let v = rt
        .execute_script(name.to_string(), src.to_string())
        .unwrap_or_else(|e| panic!("[deno_core] {name} failed: {e}"));
    deno_core::scope!(scope, rt);
    let local = v8::Local::new(scope, v);
    serde_v8::from_v8::<String>(scope, local)
        .unwrap_or_else(|e| panic!("[deno_core] {name}: result is not a string: {e}"))
}

#[tokio::main]
async fn main() {
    let bundle = std::fs::read_to_string(bundle_path()).expect("read bundle");
    let sweep = sweep_expr(&types_json());

    let mut rt = JsRuntime::new(RuntimeOptions::default());

    let t = Instant::now();
    let ok = eval_string(&mut rt, "shim", SHIM);
    println!("[deno_core] shim -> {ok} in {:?}", t.elapsed());

    let t = Instant::now();
    rt.execute_script("cstimer_module.js".to_string(), bundle)
        .unwrap_or_else(|e| panic!("[deno_core] bundle failed: {e}"));
    println!("[deno_core] bundle evaluated OK in {:?}", t.elapsed());

    let out = eval_string(&mut rt, "sweep", &sweep);
    let (dump, counts) = split_output(&out);
    print_report(&dump, &counts);
}
