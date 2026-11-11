//! Generate every one of the 206 catalogue scrambles through the real JSC
//! bridge and report the counts. This is the health check for the engine
//! boundary, matching `tools/rust-embed`'s sweep contract.

use serde::Deserialize;

use puzzle_timer::scramble::{DefaultEngine, ScrambleEngine};

#[derive(Deserialize)]
struct TypeEntry {
    id: String,
    len: u32,
}

const TYPES: &str = include_str!("../../tools/rust-embed/types.json");

fn main() -> std::process::ExitCode {
    let types: Vec<TypeEntry> =
        serde_json::from_str(TYPES).expect("tools/rust-embed/types.json is valid");

    let engine = DefaultEngine::new("42").expect("JavaScriptCore context");

    let mut ok = 0usize;
    let mut empty = 0usize;
    let mut images = 0usize;
    let mut failures = 0usize;

    for entry in &types {
        match engine.generate(&entry.id, entry.len, "", true) {
            Ok(payload) => {
                if payload.image.is_some() {
                    images += 1;
                }
                if payload.scramble.trim().is_empty() {
                    empty += 1;
                } else {
                    ok += 1;
                }
            }
            Err(error) => {
                failures += 1;
                eprintln!("FAIL {}: {error}", entry.id);
            }
        }
    }

    println!(
        "generated OK={ok} empty={empty} images={images} failures={failures} total={}",
        types.len()
    );

    if ok == types.len() && failures == 0 && empty == 0 {
        std::process::ExitCode::SUCCESS
    } else {
        std::process::ExitCode::FAILURE
    }
}
