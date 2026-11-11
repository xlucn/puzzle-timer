//! CSPRNG helpers.
//!
//! The OS entropy source lives in `src/platform/`, never in `core`.

/// A 64-hex-character seed from the CSPRNG, handed to `cstimer_module`'s
/// `setSeed()` when the scramble context starts.
///
/// Seeding deliberately (rather than letting the module decide) keeps the
/// source of randomness explicit: `getrandom` guarantees OS entropy here,
/// whereas `cstimer_module` falls back to the wall clock when no CSPRNG is
/// visible, which would make scrambles predictable.
pub fn random_seed() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("OS entropy is available");
    let mut seed = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(seed, "{byte:02x}");
    }
    seed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_sixty_four_hex_characters() {
        let seed = random_seed();
        assert_eq!(seed.len(), 64);
        assert!(seed.chars().all(|ch| ch.is_ascii_hexdigit()));
    }

    #[test]
    fn differs_between_calls() {
        assert_ne!(random_seed(), random_seed());
    }
}
