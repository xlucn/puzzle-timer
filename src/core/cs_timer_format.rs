//! The csTimer data-file codec.
//!
//! Pure Rust: reading and writing the file has no GTK and no I/O. The UI owns
//! the file chooser and the toasts; this module owns the shape, and round-trip
//! tests are its contract.
//!
//! The format, read out of csTimer's `src/js/export.js`,
//! `src/js/lib/storage.js` and `src/js/lib/tdconverter.js`:
//!
//! ```json
//! {
//!   "session1": [ [[penalty, timeMs, …phaseSplits], scramble, comment,
//!                  dateEpochSecs], … ],
//!   "properties": {
//!     "sessionN": 4,
//!     "sessionData": "{\"1\":{\"name\":\"…\",\"opt\":{\"scrType\":\"333\",
//!                      \"phases\":[]},\"rank\":1}}"
//!   }
//! }
//! ```
//!
//! Penalty is index 0 of the inner array: 0 = OK, 2000 = +2, −1 = DNF. The
//! time is raw milliseconds, so it maps straight onto `Solve.time_ms`. Phase
//! splits have no field here and are counted, not silently forgotten.
//!
//! Export carries `properties`: csTimer's `loadData()` clears its settings
//! when it sees one, and `storage.importAll()` overwrites its slots rather
//! than merging, so importing *into* csTimer is a restore. `sessionData` is
//! the load-bearing half; a real csTimer export omits the `sessionN` count and
//! derives it from the keys, so writing both is harmless.

use serde_json::{Map, Number, Value};

use super::scramble_types::{SCRAMBLE_DEFAULT_TYPE, is_scramble_type};
use super::session::{MAX_COMMENT_LENGTH, Solve};
use super::session_library::MAX_NAME_LENGTH;
use super::time::Penalty;

/// One solve as the codec reads it; the caller assigns the session type.
#[derive(Clone, Debug, PartialEq)]
pub struct ImportedSolve {
    pub time_ms: f64,
    pub scramble: String,
    pub comment: Option<String>,
    pub created_at_ms: f64,
    pub penalty: Option<Penalty>,
}

/// One file session, after validation and ordering.
#[derive(Clone, Debug, PartialEq)]
pub struct ImportedSession {
    pub name: String,
    pub scramble_type: String,
    /// csTimer's display order; ties keep their file order.
    pub rank: f64,
    pub solves: Vec<ImportedSolve>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CsTimerImport {
    pub sessions: Vec<ImportedSession>,
    /// Human-readable notes for stderr — never rendered as a raw key.
    pub warnings: Vec<String>,
}

/// What export needs from a session; the UI supplies these from the library.
#[derive(Clone, Copy, Debug)]
pub struct ExportSession<'a> {
    pub name: &'a str,
    pub scramble_type: Option<&'a str>,
    pub solves: &'a [Solve],
}

/// A file-level problem: not JSON, no sessions, or not a csTimer object.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CsTimerFormatError {
    NotJson,
    NotObject,
    NoSessions,
    NoUsableSessions,
}

impl std::fmt::Display for CsTimerFormatError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            CsTimerFormatError::NotJson => "The file is not valid JSON",
            CsTimerFormatError::NotObject => "The file is not a csTimer data object",
            CsTimerFormatError::NoSessions => "The file contains no sessions",
            CsTimerFormatError::NoUsableSessions => "The file contains no usable sessions",
        })
    }
}

impl std::error::Error for CsTimerFormatError {}

const PHASE_SPLITS_INDEX: usize = 2;
const PENALTY_OK: f64 = 0.0;
const PENALTY_PLUS2: f64 = 2000.0;
const PENALTY_DNF: f64 = -1.0;

fn as_object(value: &Value) -> Option<&Map<String, Value>> {
    value.as_object()
}

fn as_finite(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
}

/// A number that prints like JavaScript's `JSON.stringify` does — `12345`,
/// not `12345.0` — while keeping a fractional millisecond value intact.
fn json_number(value: f64) -> Value {
    if value.is_finite() && value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
        return Value::from(value as i64);
    }
    Number::from_f64(value).map_or(Value::Null, Value::Number)
}

/// `0` / `2000` / `−1`, or `None` for an unknown marker (and a warning).
fn read_penalty(value: Option<&Value>, warn: &mut dyn FnMut(String)) -> Option<Penalty> {
    let value = value?;
    match value.as_f64() {
        Some(code) if code == PENALTY_PLUS2 => Some(Penalty::Plus2),
        Some(code) if code == PENALTY_DNF => Some(Penalty::Dnf),
        Some(code) if code == PENALTY_OK => None,
        _ => {
            warn(format!("unknown penalty {value} treated as OK"));
            None
        }
    }
}

fn write_penalty(penalty: Option<Penalty>) -> f64 {
    match penalty {
        Some(Penalty::Plus2) => PENALTY_PLUS2,
        Some(Penalty::Dnf) => PENALTY_DNF,
        None => PENALTY_OK,
    }
}

fn read_comment(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?;
    let text: String = text.trim().chars().take(MAX_COMMENT_LENGTH).collect();
    (!text.is_empty()).then_some(text)
}

fn read_session_data(
    properties: Option<&Map<String, Value>>,
    warnings: &mut Vec<String>,
) -> Map<String, Value> {
    let Some(raw) = properties.and_then(|properties| properties.get("sessionData")) else {
        return Map::new();
    };
    if let Some(object) = as_object(raw) {
        return object.clone();
    }
    let Some(text) = raw.as_str() else {
        warnings.push("properties.sessionData is not a JSON string".into());
        return Map::new();
    };
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(object)) => object,
        Ok(_) => {
            warnings.push("properties.sessionData is not an object".into());
            Map::new()
        }
        Err(_) => {
            warnings.push("properties.sessionData is not valid JSON".into());
            Map::new()
        }
    }
}

/// A name that is usable in this app, or a neutral fallback.
fn read_name(meta: Option<&Map<String, Value>>, index: u64) -> String {
    let raw = meta.and_then(|meta| meta.get("name"));
    // csTimer stores whatever the user typed, including a bare number (the
    // 2017 sessions in a real export are named 9 and 12).
    let text = match raw {
        Some(Value::String(text)) => Some(text.clone()),
        Some(Value::Number(number)) => number.as_f64().map(format_js_number),
        _ => None,
    };
    let Some(text) = text else {
        return format!("Session {index}");
    };
    let name: String = text.trim().chars().take(MAX_NAME_LENGTH).collect();
    if name.is_empty() {
        format!("Session {index}")
    } else {
        name
    }
}

/// `String(number)` for the finite values a name can hold.
fn format_js_number(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}

fn read_scramble_type(
    meta: Option<&Map<String, Value>>,
    warnings: &mut Vec<String>,
    index: u64,
) -> String {
    let raw = meta
        .and_then(|meta| meta.get("opt"))
        .and_then(as_object)
        .and_then(|opt| opt.get("scrType"));
    let Some(raw) = raw else {
        return SCRAMBLE_DEFAULT_TYPE.into();
    };
    if let Some(text) = raw.as_str() {
        if is_scramble_type(text) {
            return text.into();
        }
    }
    warnings.push(format!(
        "session{index}: unknown scramble type {}; using the default",
        raw
    ));
    SCRAMBLE_DEFAULT_TYPE.into()
}

struct ReadSolves {
    solves: Vec<ImportedSolve>,
    /// Kept for parity with the v0.3.0 return shape; the warning already
    /// reports the count.
    #[allow(dead_code)]
    phase_splits: usize,
}

fn read_solves(rows: Option<&Value>, index: u64, warnings: &mut Vec<String>) -> ReadSolves {
    let Some(rows) = rows.and_then(Value::as_array) else {
        warnings.push(format!("session{index} is not an array"));
        return ReadSolves {
            solves: Vec::new(),
            phase_splits: 0,
        };
    };

    let mut solves = Vec::new();
    let mut skipped = 0;
    let mut phase_splits = 0;

    for row in rows {
        let Some(row) = row.as_array() else {
            skipped += 1;
            continue;
        };
        if row.len() < 3 {
            skipped += 1;
            continue;
        }
        let values = row[0].as_array();
        let time_ms = values
            .filter(|values| values.len() >= 2)
            .and_then(|values| values[1].as_f64())
            .filter(|time| time.is_finite() && *time >= 0.0);
        let Some(time_ms) = time_ms else {
            skipped += 1;
            continue;
        };
        // Older csTimer exports omit the date element entirely; a present but
        // non-numeric one is still a malformed row. Missing means "unknown" and
        // maps to the epoch, which the UI renders as a blank timestamp.
        let raw_date = row.get(3).filter(|value| !value.is_null());
        let date = match raw_date {
            None => 0.0,
            Some(value) => match value.as_f64().filter(|date| date.is_finite()) {
                Some(date) => date,
                None => {
                    skipped += 1;
                    continue;
                }
            },
        };
        let values = values.expect("checked above");
        if values.len() > PHASE_SPLITS_INDEX {
            phase_splits += values.len() - PHASE_SPLITS_INDEX;
        }

        let mut solve = ImportedSolve {
            time_ms,
            scramble: row[1].as_str().unwrap_or("").to_string(),
            comment: None,
            created_at_ms: (date * 1000.0).round(),
            penalty: None,
        };
        solve.penalty = read_penalty(values.first(), &mut |reason| {
            warnings.push(format!("session{index}: {reason}"));
        });
        solve.comment = read_comment(row.get(2));
        solves.push(solve);
    }

    if skipped > 0 {
        warnings.push(format!(
            "session{index}: skipped {skipped} malformed solve(s)"
        ));
    }
    if phase_splits > 0 {
        warnings.push(format!(
            "session{index}: dropped {phase_splits} phase split(s)"
        ));
    }

    // The solve list is oldest → newest by contract.
    solves.sort_by(|a, b| a.created_at_ms.total_cmp(&b.created_at_ms));
    ReadSolves {
        solves,
        phase_splits,
    }
}

/// Parse a csTimer data file. Per-session problems become warnings and the
/// rest of the file still imports; only "this is not a csTimer object" is an
/// error.
pub fn parse_cs_timer_data(text: &str) -> Result<CsTimerImport, CsTimerFormatError> {
    // A file saved by a Windows editor can carry a UTF-8 BOM, which JSON
    // parsers reject as an unexpected first character.
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let data: Value = serde_json::from_str(text).map_err(|_| CsTimerFormatError::NotJson)?;
    let Some(data) = as_object(&data) else {
        return Err(CsTimerFormatError::NotObject);
    };

    let mut warnings = Vec::new();
    let properties = data.get("properties").and_then(as_object);
    if properties.is_none() {
        warnings.push("properties is missing; reading the session keys only".into());
    }

    let declared = properties.and_then(|properties| properties.get("sessionN"));
    let declared_count = declared
        .and_then(Value::as_f64)
        .filter(|count| count.is_finite() && *count > 0.0 && count.fract() == 0.0);

    // Only the keys that are actually present matter — a missing one would be
    // csTimer's "empty session". Iterating 1…sessionN instead would hang on a
    // hand-edited `sessionN` of a billion.
    let mut indices: Vec<u64> = data
        .keys()
        .filter_map(|key| key.strip_prefix("session"))
        .filter(|rest| !rest.is_empty() && rest.bytes().all(|byte| byte.is_ascii_digit()))
        .filter_map(|rest| rest.parse::<u64>().ok())
        .collect();
    indices.sort_unstable();
    indices.dedup();
    if indices.is_empty() {
        return Err(CsTimerFormatError::NoSessions);
    }
    // csTimer's own exports carry no sessionN (its properties hold the two
    // legacy name/type strings and the sessionData JSON), so its absence is
    // normal and only a declared count above the present keys is suspicious.
    if let Some(declared) = declared_count {
        if declared as usize > indices.len() {
            warnings.push(format!(
                "properties.sessionN is {} but only {} session list(s) are present",
                declared as u64,
                indices.len()
            ));
        }
    }

    let session_data = read_session_data(properties, &mut warnings);
    let mut imported = Vec::new();

    for index in indices {
        let rows = data.get(&format!("session{index}"));
        // A present non-array is a malformed file; read_solves reports it.
        let meta = session_data.get(&index.to_string()).and_then(as_object);
        let rank = as_finite(meta.and_then(|meta| meta.get("rank"))).unwrap_or(index as f64);
        let ReadSolves { solves, .. } = read_solves(rows, index, &mut warnings);
        imported.push(ImportedSession {
            name: read_name(meta, index),
            scramble_type: read_scramble_type(meta, &mut warnings, index),
            rank,
            solves,
        });
    }

    if imported.is_empty() {
        return Err(CsTimerFormatError::NoUsableSessions);
    }
    imported.sort_by(|a, b| a.rank.total_cmp(&b.rank));
    Ok(CsTimerImport {
        sessions: imported,
        warnings,
    })
}

fn export_scramble_type(session: &ExportSession<'_>) -> String {
    if let Some(scramble_type) = session.scramble_type {
        if is_scramble_type(scramble_type) {
            return scramble_type.into();
        }
    }
    // A pre-type session index can have solves whose own type is known; the
    // newest one is the best answer csTimer's single per-session type allows.
    for solve in session.solves.iter().rev() {
        if is_scramble_type(&solve.scramble_type) {
            return solve.scramble_type.clone();
        }
    }
    SCRAMBLE_DEFAULT_TYPE.into()
}

fn export_name(session: &ExportSession<'_>, index: usize) -> String {
    let name: String = session.name.trim().chars().take(MAX_NAME_LENGTH).collect();
    if name.is_empty() {
        format!("Session {index}")
    } else {
        name
    }
}

fn export_solve(solve: &Solve) -> Value {
    Value::Array(vec![
        Value::Array(vec![
            json_number(write_penalty(solve.penalty)),
            json_number(solve.time_ms),
        ]),
        Value::String(solve.scramble.clone()),
        Value::String(solve.comment.clone().unwrap_or_default()),
        json_number((solve.created_at_ms / 1000.0).floor()),
    ])
}

/// Serialise sessions for csTimer. `properties.sessionN` and `sessionData`
/// are always present, in that order's JSON shape, because csTimer needs both
/// to restore the full list.
pub fn format_cs_timer_data(sessions: &[ExportSession<'_>]) -> String {
    let mut data = Map::new();
    let mut session_data = Map::new();

    for (offset, session) in sessions.iter().enumerate() {
        let index = offset + 1;
        data.insert(
            format!("session{index}"),
            Value::Array(session.solves.iter().map(export_solve).collect()),
        );
        session_data.insert(
            index.to_string(),
            serde_json::json!({
                "name": export_name(session, index),
                "opt": { "scrType": export_scramble_type(session), "phases": [] },
                "rank": index,
            }),
        );
    }

    let session_data = Value::Object(session_data).to_string();
    data.insert(
        "properties".into(),
        serde_json::json!({
            "sessionN": sessions.len(),
            "sessionData": session_data,
        }),
    );
    Value::Object(data).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn base_solve() -> Solve {
        Solve {
            id: 1,
            time_ms: 12_345.0,
            scramble: "R U R'".into(),
            scramble_type: "333".into(),
            created_at_ms: 1_700_000_000_000.0,
            penalty: None,
            comment: None,
        }
    }

    fn sample() -> String {
        let session_data = json!({
            "1": { "name": "  Weekly  ", "opt": { "scrType": "333" }, "rank": 2 },
            "2": { "name": "4x4", "opt": { "scrType": "444wca", "phases": [] }, "rank": 1 },
        })
        .to_string();
        json!({
            "session1": [
                [[0, 12_345], "R U R'", "", 1_700_000_000],
                [[2000, 10_000], "F2 D", "first try", 1_700_000_100],
                [[-1, 5_000], "", "", 1_700_000_200],
                [[0, 9_000, 3_000, 6_000], "D", "", 1_700_000_300],
            ],
            "session2": [],
            "properties": { "sessionN": 2, "sessionData": session_data },
        })
        .to_string()
    }

    #[test]
    fn maps_penalties_milliseconds_dates_comments_and_ranks() {
        let parsed = parse_cs_timer_data(&sample()).expect("valid csTimer file");

        let names: Vec<&str> = parsed.sessions.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["4x4", "Weekly"]);
        let ranks: Vec<f64> = parsed.sessions.iter().map(|s| s.rank).collect();
        assert_eq!(ranks, vec![1.0, 2.0]);
        let types: Vec<&str> = parsed
            .sessions
            .iter()
            .map(|s| s.scramble_type.as_str())
            .collect();
        assert_eq!(types, vec!["444wca", "333"]);
        assert!(parsed.sessions[0].solves.is_empty());

        let weekly = &parsed.sessions[1].solves;
        assert_eq!(weekly.len(), 4);
        assert_eq!(weekly[0].time_ms, 12_345.0);
        assert_eq!(weekly[0].scramble, "R U R'");
        assert_eq!(weekly[0].created_at_ms, 1_700_000_000_000.0);
        assert_eq!(weekly[1].penalty, Some(Penalty::Plus2));
        assert_eq!(weekly[1].comment.as_deref(), Some("first try"));
        assert_eq!(weekly[2].penalty, Some(Penalty::Dnf));
        assert_eq!(weekly[3].time_ms, 9_000.0);
        assert!(parsed.warnings.join("\n").contains("dropped 2 phase split"));
    }

    #[test]
    fn keeps_a_file_usable_when_optional_metadata_is_missing() {
        let parsed = parse_cs_timer_data(
            &json!({ "session1": [[[0, 1_000], "U", "", 1_700_000_000]] }).to_string(),
        )
        .expect("valid file");
        assert_eq!(parsed.sessions.len(), 1);
        assert_eq!(parsed.sessions[0].name, "Session 1");
        assert_eq!(parsed.sessions[0].scramble_type, SCRAMBLE_DEFAULT_TYPE);
        assert_eq!(parsed.sessions[0].rank, 1.0);
        assert!(parsed.warnings.join("\n").contains("properties is missing"));
    }

    #[test]
    fn falls_back_on_an_unknown_scramble_type_instead_of_losing_the_session() {
        let session_data =
            json!({ "1": { "name": "Odd", "opt": { "scrType": "no-such" } } }).to_string();
        let parsed = parse_cs_timer_data(
            &json!({ "session1": [], "properties": { "sessionN": 1, "sessionData": session_data } })
                .to_string(),
        )
        .expect("valid file");
        assert_eq!(parsed.sessions[0].scramble_type, SCRAMBLE_DEFAULT_TYPE);
        assert!(parsed.warnings.join("\n").contains("unknown scramble type"));
    }

    #[test]
    fn skips_malformed_rows_and_truncates_comments_and_names() {
        let long_comment = "x".repeat(MAX_COMMENT_LENGTH + 25);
        let long_name = "n".repeat(MAX_NAME_LENGTH + 25);
        let session_data = json!({ "1": { "name": long_name } }).to_string();
        let parsed = parse_cs_timer_data(
            &json!({
                "session1": [
                    [[0, 1_000], "U", long_comment, 1_700_000_000],
                    "not a row",
                    [[0, "soon"], "U", "", 1_700_000_100],
                    [[0, 2_000], "U", "", "yesterday"],
                ],
                "properties": { "sessionN": 1, "sessionData": session_data },
            })
            .to_string(),
        )
        .expect("valid file");
        assert_eq!(parsed.sessions[0].name.chars().count(), MAX_NAME_LENGTH);
        assert_eq!(parsed.sessions[0].solves.len(), 1);
        assert_eq!(
            parsed.sessions[0].solves[0]
                .comment
                .as_ref()
                .map(|c| c.chars().count()),
            Some(MAX_COMMENT_LENGTH)
        );
        assert!(
            parsed
                .warnings
                .join("\n")
                .contains("skipped 3 malformed solve")
        );
    }

    #[test]
    fn keeps_a_numeric_session_name_and_accepts_a_file_without_session_n() {
        let session_data = json!({ "1": { "name": 9, "opt": { "scrType": "333" } } }).to_string();
        let parsed = parse_cs_timer_data(
            &json!({ "session1": [], "properties": { "sessionData": session_data } }).to_string(),
        )
        .expect("valid file");
        assert_eq!(parsed.sessions[0].name, "9");
        assert!(parsed.warnings.is_empty());
    }

    #[test]
    fn keeps_rows_exported_without_a_date() {
        let parsed = parse_cs_timer_data(
            &json!({
                "session1": [
                    [[0, 1_000], "U", ""],
                    [[0, 2_000], "D", "note"],
                    [[0, 3_000], "F", "", 1_700_000_000],
                ],
            })
            .to_string(),
        )
        .expect("valid file");
        let dates: Vec<f64> = parsed.sessions[0]
            .solves
            .iter()
            .map(|solve| solve.created_at_ms)
            .collect();
        assert_eq!(dates, vec![0.0, 0.0, 1_700_000_000_000.0]);
        assert_eq!(
            parsed.sessions[0].solves[1].comment.as_deref(),
            Some("note")
        );
        assert!(!parsed.warnings.join("\n").contains("malformed"));
    }

    #[test]
    fn accepts_a_utf8_bom_before_the_json_object() {
        let text = format!(
            "\u{feff}{}",
            json!({ "session1": [[[0, 1_000], "U", "", 1_700_000_000]] })
        );
        let parsed = parse_cs_timer_data(&text).expect("valid file");
        assert_eq!(parsed.sessions.len(), 1);
    }

    #[test]
    fn reads_the_session_keys_not_a_hand_edited_session_n() {
        let parsed = parse_cs_timer_data(
            &json!({
                "session1": [],
                "properties": { "sessionN": 1_000_000_000u64, "sessionData": "{}" },
            })
            .to_string(),
        )
        .expect("valid file");
        assert_eq!(parsed.sessions.len(), 1);
        assert!(parsed.warnings.join("\n").contains("only 1 session list"));
    }

    #[test]
    fn warns_about_an_unknown_penalty_instead_of_dropping_the_solve() {
        let parsed = parse_cs_timer_data(
            &json!({ "session1": [[[999, 1_500], "U", "", 1_700_000_000]] }).to_string(),
        )
        .expect("valid file");
        assert_eq!(parsed.sessions[0].solves.len(), 1);
        assert_eq!(parsed.sessions[0].solves[0].penalty, None);
        assert!(parsed.warnings.join("\n").contains("unknown penalty"));
    }

    #[test]
    fn throws_only_when_the_file_is_not_a_cs_timer_object_at_all() {
        assert_eq!(
            parse_cs_timer_data("not json"),
            Err(CsTimerFormatError::NotJson)
        );
        assert_eq!(
            parse_cs_timer_data("[]"),
            Err(CsTimerFormatError::NotObject)
        );
        assert_eq!(
            parse_cs_timer_data("{}"),
            Err(CsTimerFormatError::NoSessions)
        );
    }

    fn export_sessions() -> Vec<Solve> {
        vec![
            base_solve(),
            Solve {
                id: 2,
                time_ms: 9_000.0,
                penalty: Some(Penalty::Plus2),
                comment: Some("note".into()),
                created_at_ms: 1_700_000_100_500.0,
                ..base_solve()
            },
            Solve {
                id: 3,
                time_ms: 5_000.0,
                penalty: Some(Penalty::Dnf),
                created_at_ms: 1_700_000_200_000.0,
                ..base_solve()
            },
        ]
    }

    #[test]
    fn writes_the_rows_and_the_properties_object_cstimer_restores_from() {
        let weekly = export_sessions();
        let empty: Vec<Solve> = Vec::new();
        let sessions = [
            ExportSession {
                name: "Weekly",
                scramble_type: Some("333"),
                solves: &weekly,
            },
            ExportSession {
                name: "4x4",
                scramble_type: Some("444wca"),
                solves: &empty,
            },
        ];
        let data: Value = serde_json::from_str(&format_cs_timer_data(&sessions)).expect("JSON");

        assert_eq!(data["properties"]["sessionN"], json!(2));
        let meta: Value =
            serde_json::from_str(data["properties"]["sessionData"].as_str().expect("string"))
                .expect("JSON");
        assert_eq!(
            meta["1"],
            json!({ "name": "Weekly", "opt": { "scrType": "333", "phases": [] }, "rank": 1 })
        );
        assert_eq!(
            meta["2"],
            json!({ "name": "4x4", "opt": { "scrType": "444wca", "phases": [] }, "rank": 2 })
        );

        assert_eq!(
            data["session1"],
            json!([
                [[0, 12_345], "R U R'", "", 1_700_000_000],
                [[2000, 9_000], "R U R'", "note", 1_700_000_100],
                [[-1, 5_000], "R U R'", "", 1_700_000_200],
            ])
        );
        assert_eq!(data["session2"], json!([]));
    }

    #[test]
    fn round_trips_through_the_parser() {
        let weekly = export_sessions();
        let empty: Vec<Solve> = Vec::new();
        let sessions = [
            ExportSession {
                name: "Weekly",
                scramble_type: Some("333"),
                solves: &weekly,
            },
            ExportSession {
                name: "4x4",
                scramble_type: Some("444wca"),
                solves: &empty,
            },
        ];
        let parsed = parse_cs_timer_data(&format_cs_timer_data(&sessions)).expect("valid file");
        assert!(parsed.warnings.is_empty());
        assert_eq!(parsed.sessions.len(), 2);
        assert_eq!(parsed.sessions[0].name, "Weekly");
        assert_eq!(parsed.sessions[0].scramble_type, "333");
        assert_eq!(
            parsed.sessions[0].solves,
            vec![
                ImportedSolve {
                    time_ms: 12_345.0,
                    scramble: "R U R'".into(),
                    comment: None,
                    created_at_ms: 1_700_000_000_000.0,
                    penalty: None,
                },
                ImportedSolve {
                    time_ms: 9_000.0,
                    scramble: "R U R'".into(),
                    comment: Some("note".into()),
                    created_at_ms: 1_700_000_100_000.0,
                    penalty: Some(Penalty::Plus2),
                },
                ImportedSolve {
                    time_ms: 5_000.0,
                    scramble: "R U R'".into(),
                    comment: None,
                    created_at_ms: 1_700_000_200_000.0,
                    penalty: Some(Penalty::Dnf),
                },
            ]
        );
    }

    #[test]
    fn derives_the_session_type_from_the_newest_solve_and_has_fallbacks() {
        let solves = [
            Solve {
                id: 1,
                scramble_type: "333".into(),
                ..base_solve()
            },
            Solve {
                id: 2,
                scramble_type: "444m".into(),
                ..base_solve()
            },
        ];
        let sessions = [ExportSession {
            name: "",
            scramble_type: None,
            solves: &solves,
        }];
        let data: Value = serde_json::from_str(&format_cs_timer_data(&sessions)).expect("JSON");
        let meta: Value =
            serde_json::from_str(data["properties"]["sessionData"].as_str().expect("string"))
                .expect("JSON");
        assert_eq!(meta["1"]["name"], json!("Session 1"));
        assert_eq!(meta["1"]["opt"]["scrType"], json!("444m"));
    }

    #[test]
    fn ignores_a_session_type_the_catalogue_does_not_know() {
        let solves = [base_solve()];
        let empty: Vec<Solve> = Vec::new();
        let sessions = [
            ExportSession {
                name: "Odd",
                scramble_type: Some("no-such"),
                solves: &solves,
            },
            ExportSession {
                name: "Empty",
                scramble_type: Some("no-such"),
                solves: &empty,
            },
        ];
        let data: Value = serde_json::from_str(&format_cs_timer_data(&sessions)).expect("JSON");
        let meta: Value =
            serde_json::from_str(data["properties"]["sessionData"].as_str().expect("string"))
                .expect("JSON");
        assert_eq!(meta["1"]["opt"]["scrType"], json!("333"));
        assert_eq!(meta["2"]["opt"]["scrType"], json!(SCRAMBLE_DEFAULT_TYPE));
    }
}
