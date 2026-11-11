//! The scramble boundary: the vendored `cstimer_module` bundle, its host
//! shim, and the JSC context that owns them.
//!
//! The engine is deliberately confined to this module. JSC is the default
//! because it links the system library and keeps the executable small; a V8
//! backend (the `v8` crate) is the alternative, and swapping it must only
//! touch this module — `core/` and `ui/` never see an engine.

pub mod jsc;

pub use jsc::Payload;

/// What the rest of the app needs from whichever engine is compiled in.
pub trait ScrambleEngine: Sized {
    /// Create an engine and seed its shared RNG stream once.
    fn new(seed: &str) -> Result<Self, String>;

    /// Generate one scramble, optionally with its SVG diagram.
    fn generate(
        &self,
        type_id: &str,
        length: u32,
        pre_scramble: &str,
        with_image: bool,
    ) -> Result<Payload, String>;
}

/// The engine this build uses. JSC now; a V8 build would alias its own type.
pub type DefaultEngine = jsc::Engine;

impl ScrambleEngine for jsc::Engine {
    fn new(seed: &str) -> Result<Self, String> {
        jsc::Engine::new(seed)
    }

    fn generate(
        &self,
        type_id: &str,
        length: u32,
        pre_scramble: &str,
        with_image: bool,
    ) -> Result<Payload, String> {
        self.scramble(type_id, length, pre_scramble, with_image)
    }
}
