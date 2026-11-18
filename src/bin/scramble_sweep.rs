//! Generate every one of the 206 catalogue scrambles through the real JSC
//! bridge and report the counts. This is the health check for the engine
//! boundary, matching the engine probes' sweep contract.
//!
//! `--dump` prints only the `id<TAB>json-string` lines the engine probes
//! produce, so the app's own bridge can be hashed and compared with the Node
//! reference (RUST-PORT.md §2): same seed, same call order, same md5. The
//! counts then go to stderr.
//!
//! The list is `core::scramble_types`, the table the app itself ships, so the
//! sweep cannot drift from the catalogue and does not read from `tools/`.

use puzzle_timer::core::scramble_types::SCRAMBLE_TYPES;
use puzzle_timer::scramble::{DefaultEngine, ScrambleEngine};

fn main() -> std::process::ExitCode {
    let dump = std::env::args().any(|argument| argument == "--dump");
    let total = SCRAMBLE_TYPES.len();

    let engine = DefaultEngine::new("42").expect("JavaScriptCore context");

    let mut ok = 0usize;
    let mut empty = 0usize;
    let mut images = 0usize;
    let mut failures = 0usize;
    let mut lines: Vec<String> = Vec::with_capacity(total);

    for scramble_type in SCRAMBLE_TYPES {
        // `getImage` is asked for in the same round trip as the scramble, so
        // the shared RNG stream stays aligned with the reference.
        match engine.generate(scramble_type.id, scramble_type.default_length, "", true) {
            Ok(payload) => {
                if payload.image.is_some() {
                    images += 1;
                }
                if payload.scramble.trim().is_empty() {
                    empty += 1;
                } else {
                    ok += 1;
                }
                lines.push(format!(
                    "{}\t{}",
                    scramble_type.id,
                    serde_json::to_string(&payload.scramble).expect("a string is JSON")
                ));
            }
            Err(error) => {
                failures += 1;
                eprintln!("FAIL {}: {error}", scramble_type.id);
            }
        }
    }

    let counts = format!(
        "generated OK={ok} empty={empty} images={images} failures={failures} total={total}"
    );
    if dump {
        for line in &lines {
            println!("{line}");
        }
        eprintln!("{counts}");
    } else {
        println!("{counts}");
    }

    if ok == total && failures == 0 && empty == 0 {
        std::process::ExitCode::SUCCESS
    } else {
        std::process::ExitCode::FAILURE
    }
}
