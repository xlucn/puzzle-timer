//! The JavaScriptCore host for the vendored `cstimer_module` bundle.
//!
//! This is the eight-function C API already proven by
//! `tools/rust-embed/probe-jsc`. The context is created, used and released on
//! one thread; JSC contexts must never cross a thread boundary.

use std::ffi::{CString, c_char, c_int, c_void};
use std::ptr;

use serde_json::Value;

/// The host shim: the Node-ish globals the Closure bundle's `isInNode` test
/// checks, plus the two csTimer language strings it does not bundle.
const SHIM: &str = r#"
(function(){
  var g = globalThis;
  g.global = g;
  g.process = {};
  g.require = function(){ return {}; };
  g.module = { exports: {} };
  g.console = { log: function(){}, warn: function(){}, error: function(){} };

  g.SCRAMBLE_NOOBST = [
    ['turn the top face', 'turn the bottom face'],
    ['turn the right face', 'turn the left face'],
    ['turn the front face', 'turn the back face']
  ];
  g.SCRAMBLE_NOOBSS =
    ' clockwise by 90 degrees,| counterclockwise by 90 degrees,| by 180 degrees,';

  if (!String.prototype.substr) {
    String.prototype.substr = function(start, len) {
      var s = String(this);
      start = start < 0 ? Math.max(s.length + start, 0) : Math.min(start, s.length);
      if (len === undefined) return s.slice(start);
      return s.slice(start, start + Math.max(len, 0));
    };
  }
  return 'shim-ok';
})()
"#;

/// The bundle is embedded so the packaged binary has no data-file dependency
/// for scrambling; the source stays in `vendor/` for auditing.
const BUNDLE: &str = include_str!("../../vendor/cstimer_module.js");

type JsContextRef = *const c_void;
type JsGlobalContextRef = *const c_void;
type JsStringRef = *const c_void;
type JsValueRef = *const c_void;

#[link(name = "javascriptcoregtk-6.0")]
unsafe extern "C" {
    fn JSGlobalContextCreate(global_object_class: *const c_void) -> JsGlobalContextRef;
    fn JSGlobalContextRelease(ctx: JsGlobalContextRef);
    fn JSStringCreateWithUTF8CString(string: *const c_char) -> JsStringRef;
    fn JSStringRelease(string: JsStringRef);
    fn JSStringGetMaximumUTF8CStringSize(string: JsStringRef) -> usize;
    fn JSStringGetUTF8CString(string: JsStringRef, buffer: *mut c_char, size: usize) -> usize;
    fn JSEvaluateScript(
        ctx: JsContextRef,
        script: JsStringRef,
        this_object: *const c_void,
        source_url: JsStringRef,
        starting_line_number: c_int,
        exception: *mut JsValueRef,
    ) -> JsValueRef;
    fn JSValueToStringCopy(
        ctx: JsContextRef,
        value: JsValueRef,
        exception: *mut JsValueRef,
    ) -> JsStringRef;
}

/// A released-on-drop `JSStringRef`.
struct JsStr(JsStringRef);

impl JsStr {
    fn new(text: &str) -> Result<Self, String> {
        let c = CString::new(text).map_err(|_| "NUL in JavaScript source".to_string())?;
        let raw = unsafe { JSStringCreateWithUTF8CString(c.as_ptr()) };
        if raw.is_null() {
            return Err("JavaScriptCore could not allocate a string".into());
        }
        Ok(Self(raw))
    }

    fn to_rust(&self) -> String {
        let capacity = unsafe { JSStringGetMaximumUTF8CStringSize(self.0) };
        let mut buffer = vec![0u8; capacity];
        let written = unsafe {
            JSStringGetUTF8CString(self.0, buffer.as_mut_ptr().cast::<c_char>(), capacity)
        };
        buffer.truncate(written.saturating_sub(1)); // drop the trailing NUL
        String::from_utf8_lossy(&buffer).into_owned()
    }
}

impl Drop for JsStr {
    fn drop(&mut self) {
        unsafe { JSStringRelease(self.0) }
    }
}

/// One JSC global context. Not `Send`: keep it on the thread that made it.
pub struct Context {
    raw: JsGlobalContextRef,
}

impl Context {
    fn new() -> Self {
        let raw = unsafe { JSGlobalContextCreate(ptr::null()) };
        assert!(!raw.is_null(), "JavaScriptCore could not create a context");
        Self { raw }
    }

    /// Evaluate one script and return its value as a string.
    fn eval(&self, name: &str, source: &str) -> Result<String, String> {
        let script = JsStr::new(source)?;
        let mut exception: JsValueRef = ptr::null();

        let value = unsafe {
            JSEvaluateScript(
                self.raw,
                script.0,
                ptr::null(),
                ptr::null(),
                1,
                &mut exception,
            )
        };

        if value.is_null() {
            return Err(format!("[{name}] {}", self.describe(exception)));
        }

        let mut copy_exception: JsValueRef = ptr::null();
        let copied = unsafe { JSValueToStringCopy(self.raw, value, &mut copy_exception) };
        if copied.is_null() {
            return Err(format!("[{name}] result is not stringifiable"));
        }
        let text = JsStr(copied);
        Ok(text.to_rust())
    }

    fn describe(&self, value: JsValueRef) -> String {
        if value.is_null() {
            return "<no exception>".into();
        }
        let mut exception: JsValueRef = ptr::null();
        let copied = unsafe { JSValueToStringCopy(self.raw, value, &mut exception) };
        if copied.is_null() {
            return "<unprintable exception>".into();
        }
        JsStr(copied).to_rust()
    }
}

impl Drop for Context {
    fn drop(&mut self) {
        unsafe { JSGlobalContextRelease(self.raw) }
    }
}

/// One scramble and, when asked for, its SVG.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Payload {
    pub scramble: String,
    pub image: Option<String>,
}

/// A JSC context that already has the shim and the bundle loaded.
pub struct Engine {
    context: Context,
}

impl Engine {
    /// Create an engine and seed its shared RNG stream once.
    pub fn new(seed: &str) -> Result<Self, String> {
        let context = Context::new();
        context.eval("shim", SHIM)?;
        context.eval("bundle", BUNDLE)?;
        context.eval(
            "seed",
            &format!("globalThis.module.exports.setSeed({})", json_string(seed)),
        )?;
        Ok(Self { context })
    }

    /// Generate one scramble. `with_image` mirrors the v0.3.0 worker: the
    /// image is produced in the same round trip, and `getImage` is called only
    /// when asked, because it advances the shared RNG stream.
    pub fn scramble(
        &self,
        type_id: &str,
        length: u32,
        pre_scramble: &str,
        with_image: bool,
    ) -> Result<Payload, String> {
        let type_json = json_string(type_id);
        let pre_json = json_string(pre_scramble);
        let script = if with_image {
            format!(
                r#"(function(){{
                  var c = globalThis.module.exports;
                  c.setGlobal('preScr', {pre_json});
                  var s = c.getScramble({type_json}, {length});
                  var im = c.getImage(s, {type_json});
                  return JSON.stringify([s, (typeof im === 'string' ? im : null)]);
                }})()"#
            )
        } else {
            format!(
                r#"(function(){{
                  var c = globalThis.module.exports;
                  c.setGlobal('preScr', {pre_json});
                  var s = c.getScramble({type_json}, {length});
                  return JSON.stringify([s, null]);
                }})()"#
            )
        };

        let output = self.context.eval("scramble", &script)?;
        let parsed: Value = serde_json::from_str(&output)
            .map_err(|error| format!("scramble reply is not JSON: {error}: {output}"))?;
        let array = parsed
            .as_array()
            .ok_or_else(|| "scramble reply is not an array".to_string())?;
        let scramble = array
            .first()
            .and_then(Value::as_str)
            .ok_or_else(|| "scrambler returned no text".to_string())?
            .to_string();
        let image = array
            .get(1)
            .and_then(Value::as_str)
            .map(ToString::to_string);

        Ok(Payload { scramble, image })
    }
}

/// JSON string literals are valid JavaScript string literals, quotes and all.
fn json_string(text: &str) -> String {
    serde_json::to_string(text).expect("strings are JSON-serialisable")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_a_3x3_scramble() {
        let engine = Engine::new("42").expect("engine");
        let payload = engine
            .scramble("333", 25, "", true)
            .expect("3x3 scramble should generate");

        assert!(!payload.scramble.trim().is_empty());
        assert!(payload.scramble.split_whitespace().count() >= 20);
        assert!(
            payload
                .image
                .as_deref()
                .is_some_and(|svg| svg.starts_with('<')),
            "3x3 has a diagram"
        );
    }

    #[test]
    fn the_pre_scramble_is_accepted() {
        let engine = Engine::new("7").expect("engine");
        let payload = engine.scramble("333", 25, "y", false).expect("scramble");
        assert!(!payload.scramble.is_empty());
        assert!(payload.image.is_none());
    }
}
