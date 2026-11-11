//! Puzzle Timer — a native GTK4/libadwaita speedcubing timer.
//!
//! The modules follow the port's boundaries: `core` is pure Rust, `platform`
//! owns OS/IO, `scramble` owns the embedded JavaScript engine, and `ui` is the
//! only place that touches GTK.

pub mod core;
pub mod locales;
pub mod platform;
pub mod scramble;
pub mod ui;
