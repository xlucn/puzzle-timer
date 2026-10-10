//! JavaScriptCore (Safari's engine), bound directly through its C API.
//!
//! Why this probe exists: JSC is the one fast engine besides V8 that ships as
//! a **system library** on a GNOME box (`libjavascriptcoregtk-4.1.so`, pulled
//! in by WebKitGTK, already installed here). So it may offer V8-class speed
//! with *no* engine in the binary at all — the opposite of a 44 MB static V8.
//!
//! The C API (`JavaScriptCore/JavaScript.h`) is decades-stable, so this binds
//! it with a bare `extern "C"` block instead of a crate: one dependency
//! (`probe-common`), one `-l` flag.
//!
//! Same probe contract as the others: print `===DUMP===` … `===COUNTS===`.
//!
//! Run: `cargo build --release -p probe-jsc && ./target/release/probe-jsc`

use probe_common::{bundle_path, print_report, split_output, sweep_expr, types_json, SHIM};
use std::ffi::{c_char, c_int, c_void, CString};
use std::ptr;
use std::time::Instant;

/// All JSC refs are opaque pointers; the C API is handle-based throughout.
type JSContextRef = *const c_void;
type JSGlobalContextRef = *const c_void;
type JSStringRef = *const c_void;
type JSValueRef = *const c_void;

// The link name is the only difference between the two flavours: both `.so`s
// export the same eight symbols at the same WebKit version. `jsc6` (default)
// is what gnome-shell depends on; `jsc4` is the WebKitGTK3 flavour.
#[cfg(all(feature = "jsc6", feature = "jsc4"))]
compile_error!("pick one of jsc6 / jsc4, not both");
#[cfg(not(any(feature = "jsc6", feature = "jsc4")))]
compile_error!("enable exactly one of jsc6 / jsc4");

#[cfg_attr(feature = "jsc6", link(name = "javascriptcoregtk-6.0"))]
#[cfg_attr(feature = "jsc4", link(name = "javascriptcoregtk-4.1"))]
unsafe extern "C" {
    fn JSGlobalContextCreate(global_object_class: *const c_void) -> JSGlobalContextRef;
    fn JSGlobalContextRelease(ctx: JSGlobalContextRef);
    fn JSStringCreateWithUTF8CString(string: *const c_char) -> JSStringRef;
    fn JSStringRelease(string: JSStringRef);
    fn JSStringGetMaximumUTF8CStringSize(string: JSStringRef) -> usize;
    fn JSStringGetUTF8CString(string: JSStringRef, buffer: *mut c_char, size: usize) -> usize;
    fn JSEvaluateScript(
        ctx: JSContextRef,
        script: JSStringRef,
        this_object: *const c_void,
        source_url: JSStringRef,
        starting_line_number: c_int,
        exception: *mut JSValueRef,
    ) -> JSValueRef;
    fn JSValueToStringCopy(
        ctx: JSContextRef,
        value: JSValueRef,
        exception: *mut JSValueRef,
    ) -> JSStringRef;
}

/// A released-on-drop `JSStringRef`.
struct JsStr(JSStringRef);

impl JsStr {
    fn new(s: &str) -> Self {
        let c = CString::new(s).expect("NUL in JS source");
        Self(unsafe { JSStringCreateWithUTF8CString(c.as_ptr()) })
    }
    fn to_rust(&self) -> String {
        let cap = unsafe { JSStringGetMaximumUTF8CStringSize(self.0) };
        let mut buf = vec![0u8; cap];
        let n = unsafe {
            JSStringGetUTF8CString(self.0, buf.as_mut_ptr() as *mut c_char, cap)
        };
        buf.truncate(n.max(1) - 1); // drop the terminating NUL
        String::from_utf8_lossy(&buf).into_owned()
    }
}
impl Drop for JsStr {
    fn drop(&mut self) {
        unsafe { JSStringRelease(self.0) }
    }
}

/// Evaluate one script, reporting JSC's exception message on failure.
///
/// JSC hands exceptions back through an out-param rather than a scope, so
/// there is no TryCatch equivalent to get wrong — arguably simpler than
/// rusty_v8's `tc_scope!`.
fn eval(ctx: JSGlobalContextRef, name: &str, src: &str) -> Result<String, String> {
    let script = JsStr::new(src);
    let mut exception: JSValueRef = ptr::null();

    let value = unsafe {
        JSEvaluateScript(
            ctx,
            script.0,
            ptr::null(), // thisObject — the global is fine for a script
            ptr::null(), // sourceURL
            1,
            &mut exception,
        )
    };

    if value.is_null() {
        return Err(format!("[jsc] {name}: {}", describe(ctx, exception)));
    }

    let mut exc2: JSValueRef = ptr::null();
    let copied = unsafe { JSValueToStringCopy(ctx, value, &mut exc2) };
    if copied.is_null() {
        return Err(format!("[jsc] {name}: result is not stringifiable"));
    }
    let s = JsStr(copied);
    Ok(s.to_rust())
}

/// Render a JS value (the exception) as text.
fn describe(ctx: JSGlobalContextRef, v: JSValueRef) -> String {
    if v.is_null() {
        return "<no exception>".into();
    }
    let mut exc: JSValueRef = ptr::null();
    let s = unsafe { JSValueToStringCopy(ctx, v, &mut exc) };
    if s.is_null() {
        return "<unprintable exception>".into();
    }
    JsStr(s).to_rust()
}

fn main() {
    let bundle = std::fs::read_to_string(bundle_path()).expect("read bundle");
    let sweep = sweep_source();

    // JSGlobalContextCreate spins up JSC's VM; releasing the context tears it
    // down. One context per process, like one Isolate in the v8 probe.
    let ctx = unsafe { JSGlobalContextCreate(ptr::null()) };
    if ctx.is_null() {
        println!("[jsc] JSGlobalContextCreate failed");
        return;
    }

    match eval(ctx, "shim", SHIM) {
        Ok(v) => println!("[jsc] shim -> {v}"),
        Err(e) => {
            println!("{e}");
            return;
        }
    }

    let t0 = Instant::now();
    match eval(ctx, "cstimer_module.js", &bundle) {
        Ok(_) => println!("[jsc] bundle evaluated OK in {:?}", t0.elapsed()),
        Err(e) => {
            println!("{e}");
            return;
        }
    }

    match eval(ctx, "sweep", &sweep) {
        Ok(out) => {
            let (dump, counts) = split_output(&out);
            print_report(&dump, &counts);
        }
        Err(e) => println!("{e}"),
    }

    unsafe { JSGlobalContextRelease(ctx) };
}

/// Kept as a function so the `main` above reads like the other probes.
fn sweep_source() -> String {
    sweep_expr(&types_json())
}
