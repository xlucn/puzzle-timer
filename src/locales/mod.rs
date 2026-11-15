//! The English catalog.
//!
//! `en` is the source of truth and, because gettext identifies a message by its
//! English text, it is also the msgid table: `po/*.po` translate these strings.
//! `src/core/i18n.rs` is the runtime that asks the installed catalog and fills
//! placeholders.

pub mod en;
