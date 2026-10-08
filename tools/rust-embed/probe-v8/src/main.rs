//! `v8` (rusty_v8) used **directly** — no `deno_core` on top.
//!
//! The question this probe answers: deno_core's real additions over rusty_v8
//! are the *op system* (Rust↔JS FFI), an *event loop* mapping JS Promises onto
//! Rust Futures, module loading, and startup snapshots — not CLI glue, the CLI
//! is a separate crate (`deno_cli`). Does the cstimer_module bundle need any
//! of it?
//!
//! It does not: the bundle is a synchronous ES5 script — no Promises, no
//! dynamic imports, no ops. So the runtime is platform init, one Isolate, one
//! Context, and three `Script::compile` + `run` calls. That also drops
//! deno_core's tokio requirement, which came from deno_core's own
//! delayed-task plumbing rather than from V8.
//!
//! Same probe contract as the others: print `===DUMP===` … `===COUNTS===`
//! so `run.sh` can diff it against Node.
//!
//! Run: `cargo run --release -p probe-v8`

use probe_common::{bundle_path, print_report, split_output, sweep_expr, types_json, SHIM};
use std::time::Instant;

/// Compile + run one script, surfacing a V8 exception in V8's own words.
///
/// `tc_scope!` installs a TryCatch whose scope derefs to a `PinScope`, which
/// is what `String::new` / `Script::compile` / `run` all accept — the same
/// shape `examples/shell.rs` uses.
fn eval(scope: &mut v8::PinScope, name: &str, src: &str) -> Result<String, String> {
    v8::tc_scope!(let tc, scope);

    let source = v8::String::new(tc, src)
        .ok_or_else(|| format!("[rusty_v8] {name}: source too long for a V8 string"))?;

    let script = match v8::Script::compile(tc, source, None) {
        Some(s) => s,
        None => {
            assert!(tc.has_caught());
            return Err(format!("[rusty_v8] {name}: compile error: {}", exception(tc)));
        }
    };

    match script.run(tc) {
        Some(value) => Ok(value.to_rust_string_lossy(tc)),
        None => {
            assert!(tc.has_caught());
            Err(format!("[rusty_v8] {name}: threw: {}", exception(tc)))
        }
    }
}

fn exception(tc: &mut v8::PinnedRef<'_, v8::TryCatch<v8::HandleScope>>) -> String {
    tc.exception()
        .map(|e| e.to_rust_string_lossy(tc))
        .unwrap_or_else(|| "<no exception object>".into())
}

fn main() {
    let bundle = std::fs::read_to_string(bundle_path()).expect("read bundle");
    let sweep = sweep_expr(&types_json());

    // V8's platform is process-global and must be initialised exactly once.
    let platform = v8::new_default_platform(0, false).make_shared();
    v8::V8::initialize_platform(platform);
    v8::V8::initialize();

    let isolate = &mut v8::Isolate::new(Default::default());
    v8::scope!(let scope, isolate);
    let context = v8::Context::new(scope, Default::default());
    let scope = &mut v8::ContextScope::new(scope, context);

    match eval(scope, "shim", SHIM) {
        Ok(v) => println!("[rusty_v8] shim -> {v}"),
        Err(e) => {
            println!("{e}");
            return;
        }
    }

    let t0 = Instant::now();
    match eval(scope, "cstimer_module.js", &bundle) {
        Ok(_) => println!("[rusty_v8] bundle evaluated OK in {:?}", t0.elapsed()),
        Err(e) => {
            println!("{e}");
            return;
        }
    }

    match eval(scope, "sweep", &sweep) {
        Ok(out) => {
            let (dump, counts) = split_output(&out);
            print_report(&dump, &counts);
        }
        Err(e) => println!("{e}"),
    }

    // Deliberately no V8::dispose / isolate teardown: this is a short-lived
    // probe, and skipping it keeps the happy path free of `unsafe`. A
    // long-lived app must dispose properly.
}
