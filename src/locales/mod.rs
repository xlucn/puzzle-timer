//! Typed locale catalogs.
//!
//! `en` is the source of truth; `zh_cn` covers every key, so a missing string
//! is a compile error rather than a raw key on screen. `src/core/i18n.rs` is
//! the runtime that picks a catalog and interpolates placeholders.

pub mod en;
pub mod zh_cn;
