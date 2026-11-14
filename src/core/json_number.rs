//! Numbers written the way v0.3.0 wrote them.
//!
//! JavaScript's `JSON.stringify` prints a whole number without a fractional
//! part: `1700000000000`, never `1700000000000.0`. Rust's `serde_json` prints
//! an `f64` with `.0`, which parses back to the same value but rewrites every
//! date and every size in a file the app touches. Files are hand-editable and
//! users do diff them, so the shape is part of the format.

use serde::{Serialize, Serializer, ser::Error as _};
use serde_json::{Number, Value};

/// Beyond this a whole `f64` no longer describes every integer exactly, so it
/// keeps its float form rather than silently rounding.
const MAX_EXACT_INTEGER: f64 = 9_007_199_254_740_992.0;

/// `value` as JSON: an integer when it is whole, a float otherwise.
pub fn to_value(value: f64) -> Value {
    if value.is_finite() && value.fract() == 0.0 && value.abs() < MAX_EXACT_INTEGER {
        return Value::from(value as i64);
    }
    Number::from_f64(value).map_or(Value::Null, Value::Number)
}

/// `serde(serialize_with = …)` for an `f64` field.
pub fn serialize<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    to_value(*value)
        .serialize(serializer)
        .map_err(S::Error::custom)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[derive(Serialize)]
    struct Sample {
        #[serde(serialize_with = "serialize")]
        whole: f64,
        #[serde(serialize_with = "serialize")]
        fractional: f64,
        #[serde(serialize_with = "serialize")]
        huge: f64,
    }

    #[test]
    fn whole_numbers_read_like_javascript() {
        let text = serde_json::to_string(&Sample {
            whole: 1_700_000_000_000.0,
            fractional: 1216.402,
            huge: 1e300,
        })
        .unwrap();
        assert_eq!(
            text,
            r#"{"whole":1700000000000,"fractional":1216.402,"huge":1e+300}"#
        );
    }

    #[test]
    fn to_value_keeps_the_type() {
        assert_eq!(to_value(300.0), json!(300));
        assert_eq!(to_value(0.75), json!(0.75));
        assert_eq!(to_value(-2.0), json!(-2));
        assert_eq!(to_value(f64::NAN), Value::Null);
    }
}
