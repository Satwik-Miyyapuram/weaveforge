//! Port of the experiment status and metric display helpers in packages/core/src/features/experiments/domain/experiment.ts. Pure.

use std::num::FpCategory;

use serde_json::Value;

use crate::reader_analysis::lines::js_trim;

/// Shown for a value that has no text (TS `"—"`).
const DASH: &str = "—";

/// Experiment lifecycle status (TS `ExperimentStatus`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ExperimentStatus {
    /// Not started yet.
    Planned,
    /// In progress.
    Running,
    /// Finished successfully.
    Done,
    /// Finished with an error.
    Failed,
    /// Stopped without finishing.
    Abandoned,
}

/// The fields of TS `Experiment` that the status helpers read.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Experiment {
    /// Current status.
    pub status: ExperimentStatus,
    /// First start, ISO 8601 UTC.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub started_at: Option<String>,
    /// Creation time, ISO 8601 UTC.
    pub created_at: String,
}

/// The status-related fields after a transition (TS `Pick<Experiment, "status" | "startedAt" | "finishedAt">`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExperimentStatusPatch {
    /// The new status.
    pub status: ExperimentStatus,
    /// First start, kept across restarts.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub started_at: Option<String>,
    /// Set only while the status is terminal.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub finished_at: Option<String>,
}

/// The statuses that end a run (TS `TERMINAL_EXPERIMENT_STATUSES`).
pub const TERMINAL_EXPERIMENT_STATUSES: &[ExperimentStatus] = &[
    ExperimentStatus::Done,
    ExperimentStatus::Failed,
    ExperimentStatus::Abandoned,
];

/// Running experiments with no finish and no activity this long are treated as dead (ms).
pub const STALE_RUNNING_MS: f64 = 2.0 * 60.0 * 1000.0;

/// The status-related fields for a run moving to `status` at `now`.
///
/// `finishedAt` is set exactly when the status is terminal, so leaving one clears it.
/// The first start is kept, so a restart does not rewrite history.
#[must_use]
pub fn status_patch_for_experiment(
    experiment: &Experiment,
    status: ExperimentStatus,
    now: &str,
) -> ExperimentStatusPatch {
    // JS `!startedAt` also treats an empty string as unset.
    let start_unset = experiment.started_at.as_deref().unwrap_or("").is_empty();
    let started_at = if status == ExperimentStatus::Running && start_unset {
        Some(now.to_owned())
    } else {
        experiment.started_at.clone()
    };
    let finished_at = if TERMINAL_EXPERIMENT_STATUSES.contains(&status) {
        Some(now.to_owned())
    } else {
        None
    };
    ExperimentStatusPatch {
        status,
        started_at,
        finished_at,
    }
}

/// Short display form of a commit SHA: trimmed, then the first seven UTF-16 units (TS `shortSha`).
#[must_use]
pub fn short_sha(sha: Option<&str>) -> Option<String> {
    let sha = sha.filter(|s| !s.is_empty())?;
    Some(js_slice_start(js_trim(sha), 7))
}

/// When the run last showed life, in ms since the epoch: `startedAt`, else `createdAt`.
/// `0` when the timestamp does not parse (TS `experimentActivityAt`).
#[must_use]
pub fn experiment_activity_at(experiment: &Experiment) -> f64 {
    let raw = experiment
        .started_at
        .as_deref()
        .unwrap_or(experiment.created_at.as_str());
    parse_iso_utc_ms(raw).unwrap_or(0.0)
}

/// Whether a running experiment has been silent for `stale_ms`, counting its last metric time
/// when given (TS `isStaleRunningExperiment`; the caller supplies `now_ms`).
#[must_use]
pub fn is_stale_running_experiment(
    experiment: &Experiment,
    now_ms: f64,
    stale_ms: f64,
    last_metric_at_ms: Option<f64>,
) -> bool {
    if experiment.status != ExperimentStatus::Running {
        return false;
    }
    let last = last_metric_at_ms.unwrap_or(0.0);
    // JS `Math.max` yields NaN for a NaN input, and NaN is falsy.
    if last.is_nan() {
        return false;
    }
    let activity = experiment_activity_at(experiment).max(last);
    // JS `!activity` is also true for zero.
    if activity.classify() == FpCategory::Zero {
        return false;
    }
    now_ms - activity >= stale_ms
}

/// Format a numeric metric value for tables and chart axes; name-agnostic (TS `formatMetricValue`).
#[must_use]
pub fn format_metric_value(_metric: &str, value: f64) -> String {
    if !value.is_finite() {
        return DASH.to_owned();
    }
    // Zero has no magnitude band.
    if value.classify() == FpCategory::Zero {
        return "0".to_owned();
    }
    let abs = value.abs();
    if abs >= 1e6 || abs < 1e-4 {
        return to_exponential_2(value);
    }
    if abs >= 100.0 {
        return to_fixed(value, 1);
    }
    if abs >= 1.0 {
        return to_fixed(value, 3);
    }
    if abs >= 0.01 {
        return to_fixed(value, 4);
    }
    to_exponential_2(value)
}

/// One metric's value as text, for a chip or table cell (TS `formatMetricCell`).
///
/// Numbers and numeric strings go through [`format_metric_value`]; other values are shown as
/// compact JSON, and `—` when JSON has no form for them.
#[must_use]
pub fn format_metric_cell(metric: &str, value: &Value) -> String {
    match value {
        Value::Null => DASH.to_owned(),
        Value::String(s) if js_trim(s).is_empty() => DASH.to_owned(),
        Value::String(s) => {
            let n = js_string_to_number(s);
            if n.is_finite() {
                format_metric_value(metric, n)
            } else {
                s.to_owned()
            }
        }
        Value::Number(n) => n
            .as_f64()
            .map_or_else(|| DASH.to_owned(), |x| format_metric_value(metric, x)),
        Value::Bool(b) => b.to_string(),
        Value::Array(_) | Value::Object(_) => json_text(value),
    }
}

/// `s.slice(0, n)` in UTF-16 units. A surrogate pair the cut would split is dropped whole.
fn js_slice_start(s: &str, n: usize) -> String {
    let mut units = 0;
    s.chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= n
        })
        .collect()
}

/// `Date.parse` for the ES date-time format with a zone: `YYYY-MM-DD`, or
/// `YYYY-MM-DDTHH:MM[:SS[.fff]]` ending in `Z` or `+HH:MM` / `-HH:MM`. Postgres timestamps
/// come as the latter. A date-time with no zone is local time in JS, which Rust cannot know,
/// so it is `None` here, as is anything else.
fn parse_iso_utc_ms(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    let y = digits(b, 0, 4)?;
    if b.get(4) != Some(&b'-') || b.get(7) != Some(&b'-') {
        return None;
    }
    let mo = digits(b, 5, 2)?;
    let d = digits(b, 8, 2)?;
    if !(1..=12).contains(&mo) || !(1..=days_in_month(y, mo)).contains(&d) {
        return None;
    }
    let day_ms = f64::from(days_from_civil(y, mo, d)) * 86_400_000.0;
    if b.len() == 10 {
        // A date alone is UTC midnight.
        return Some(day_ms);
    }
    if b.get(10) != Some(&b'T') || b.get(13) != Some(&b':') {
        return None;
    }
    let h = digits(b, 11, 2)?;
    let mi = digits(b, 14, 2)?;
    let mut pos = 16;
    let mut sec = 0;
    let mut ms = 0;
    if b.get(pos) == Some(&b':') {
        sec = digits(b, 17, 2)?;
        pos = 19;
        if b.get(pos) == Some(&b'.') {
            pos += 1;
            let start = pos;
            while b.get(pos).is_some_and(u8::is_ascii_digit) {
                pos += 1;
            }
            if pos == start {
                return None;
            }
            // The first three fraction digits, right-padded: ".5" is 500 ms.
            for i in 0..3 {
                let c = if start + i < pos {
                    i32::from(b[start + i] - b'0')
                } else {
                    0
                };
                ms = ms * 10 + c;
            }
        }
    }
    let offset_min = match b.get(pos) {
        Some(b'Z') if b.len() == pos + 1 => 0,
        Some(&sign @ (b'+' | b'-')) if b.len() == pos + 6 && b[pos + 3] == b':' => {
            let oh = digits(b, pos + 1, 2)?;
            let om = digits(b, pos + 4, 2)?;
            if oh > 23 || om > 59 {
                return None;
            }
            let total = oh * 60 + om;
            if sign == b'-' { -total } else { total }
        }
        _ => return None,
    };
    if mi > 59 || sec > 59 || h > 24 || (h == 24 && (mi, sec, ms) != (0, 0, 0)) {
        return None;
    }
    Some(
        day_ms
            + f64::from(h) * 3_600_000.0
            + f64::from(mi) * 60_000.0
            + f64::from(sec) * 1_000.0
            + f64::from(ms)
            - f64::from(offset_min) * 60_000.0,
    )
}

/// `count` ASCII digits at `at`, read as an integer.
fn digits(b: &[u8], at: usize, count: usize) -> Option<i32> {
    let part = b.get(at..at + count)?;
    if !part.iter().all(u8::is_ascii_digit) {
        return None;
    }
    part.iter()
        .try_fold(0_i32, |acc, &c| Some(acc * 10 + i32::from(c - b'0')))
}

fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i32, m: i32) -> i32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if is_leap(y) => 29,
        _ => 28,
    }
}

/// Days since 1970-01-01 for a proleptic Gregorian date (H. Hinnant's algorithm).
fn days_from_civil(y: i32, m: i32, d: i32) -> i32 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// `Number(s)` for the text cases that matter here. `NaN` where JS gives a non-finite value
/// or no number at all, which the caller treats the same way.
fn js_string_to_number(s: &str) -> f64 {
    let t = js_trim(s);
    if t.is_empty() {
        return 0.0;
    }
    if let Some(hex) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        return radix_value(hex, 16);
    }
    if let Some(oct) = t.strip_prefix("0o").or_else(|| t.strip_prefix("0O")) {
        return radix_value(oct, 8);
    }
    if let Some(bin) = t.strip_prefix("0b").or_else(|| t.strip_prefix("0B")) {
        return radix_value(bin, 2);
    }
    let body = t
        .strip_prefix('+')
        .or_else(|| t.strip_prefix('-'))
        .unwrap_or(t);
    if is_decimal_literal(body) {
        t.parse::<f64>().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}

fn radix_value(digits: &str, radix: u32) -> f64 {
    if digits.is_empty() {
        return f64::NAN;
    }
    digits
        .chars()
        .try_fold(0.0_f64, |acc, c| {
            c.to_digit(radix)
                .map(|d| acc * f64::from(radix) + f64::from(d))
        })
        .unwrap_or(f64::NAN)
}

/// `[digits][.digits][(e|E)[+-]digits]` with at least one mantissa digit.
fn is_decimal_literal(body: &str) -> bool {
    let (mant, exp) = match body.split_once(['e', 'E']) {
        Some((m, e)) => (m, Some(e)),
        None => (body, None),
    };
    let (int, frac) = mant.split_once('.').unwrap_or((mant, ""));
    let all_digits = |s: &str| s.bytes().all(|c| c.is_ascii_digit());
    let mantissa_ok = all_digits(int) && all_digits(frac) && !(int.is_empty() && frac.is_empty());
    let exp_ok = match exp {
        None => true,
        Some(e) => {
            let e = e
                .strip_prefix('+')
                .or_else(|| e.strip_prefix('-'))
                .unwrap_or(e);
            !e.is_empty() && all_digits(e)
        }
    };
    mantissa_ok && exp_ok
}

/// `JSON.stringify` for a parsed JSON value: compact, keys in order, numbers as JS prints them.
fn json_text(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => match n.as_f64() {
            Some(x) if x.is_finite() => js_number_string(x),
            _ => "null".to_owned(),
        },
        Value::String(s) => serde_json::to_string(s).unwrap_or_default(),
        Value::Array(items) => format!(
            "[{}]",
            items.iter().map(json_text).collect::<Vec<_>>().join(",")
        ),
        Value::Object(map) => format!(
            "{{{}}}",
            map.iter()
                .map(|(k, v)| format!(
                    "{}:{}",
                    serde_json::to_string(k).unwrap_or_default(),
                    json_text(v)
                ))
                .collect::<Vec<_>>()
                .join(",")
        ),
    }
}

/// JS `Number::toString` for a finite `x`: shortest round-trip digits with JS exponent rules.
fn js_number_string(x: f64) -> String {
    if x.classify() == FpCategory::Zero {
        return "0".to_owned();
    }
    let sign = if x < 0.0 { "-" } else { "" };
    // `{:e}` gives the shortest round-trip digits as `d.ddde<exp>`.
    let s = format!("{:e}", x.abs());
    let (mant, exp) = s.split_once('e').unwrap_or((s.as_str(), "0"));
    let digits: String = mant.chars().filter(char::is_ascii_digit).collect();
    let k = i32::try_from(digits.len()).unwrap_or(0);
    let n = exp.parse::<i32>().unwrap_or(0) + 1;
    let body = if (k..=21).contains(&n) {
        format!(
            "{digits}{}",
            "0".repeat(usize::try_from(n - k).unwrap_or(0))
        )
    } else if (1..=21).contains(&n) {
        let (int, frac) = digits.split_at(usize::try_from(n).unwrap_or(0));
        format!("{int}.{frac}")
    } else if (-5..=0).contains(&n) {
        format!("0.{}{digits}", "0".repeat(usize::try_from(-n).unwrap_or(0)))
    } else {
        let e = n - 1;
        let esign = if e < 0 { '-' } else { '+' };
        let (first, rest) = digits.split_at(1);
        let m = if rest.is_empty() {
            first.to_owned()
        } else {
            format!("{first}.{rest}")
        };
        format!("{m}e{esign}{}", e.abs())
    };
    format!("{sign}{body}")
}

/// Decimal digits of a finite, non-zero `x`, exact: `(digits, e)` with `x = 0.d1d2… × 10^(e+1)`.
fn exact_digits(x: f64) -> (Vec<u8>, i32) {
    // 800 significant digits covers every f64 (at most 767), so the expansion is exact.
    let s = format!("{x:.800e}");
    let (mant, exp) = s.split_once('e').unwrap_or((s.as_str(), "0"));
    let digits = mant
        .bytes()
        .filter(u8::is_ascii_digit)
        .map(|b| b - b'0')
        .collect();
    let e: i32 = exp.parse().unwrap_or(0);
    (digits, e)
}

/// `Number.prototype.toFixed(frac)` for `|x| < 1e6` and `frac <= 4`. Ties round up, as JS does.
fn to_fixed(x: f64, frac: i32) -> String {
    let places = usize::try_from(frac).unwrap_or(0);
    let mut n: u64 = 0;
    if x.abs().classify() != FpCategory::Zero {
        let (digits, e) = exact_digits(x.abs());
        // Digits with weight 10^-frac or larger.
        if let Ok(keep) = usize::try_from(e + frac + 1) {
            n = digits
                .iter()
                .take(keep)
                .fold(0, |acc, &d| acc * 10 + u64::from(d));
            if digits.get(keep).is_some_and(|&d| d >= 5) {
                n += 1;
            }
        }
    }
    let n_text = n.to_string();
    let body = if places == 0 {
        n_text
    } else {
        let padded = format!("{n_text:0>w$}", w = places + 1);
        let (int, dec) = padded.split_at(padded.len() - places);
        format!("{int}.{dec}")
    };
    if x < 0.0 { format!("-{body}") } else { body }
}

/// `Number.prototype.toExponential(2)` for finite, non-zero `x`. Ties round up, as JS does.
fn to_exponential_2(x: f64) -> String {
    let sign = if x < 0.0 { "-" } else { "" };
    let (digits, mut e) = exact_digits(x.abs());
    let mut n = digits
        .iter()
        .take(3)
        .fold(0_u32, |acc, &d| acc * 10 + u32::from(d));
    if digits.get(3).is_some_and(|&d| d >= 5) {
        n += 1;
    }
    if n == 1000 {
        n = 100;
        e += 1;
    }
    let esign = if e < 0 { '-' } else { '+' };
    format!(
        "{sign}{}.{}{}e{esign}{}",
        n / 100,
        n / 10 % 10,
        n % 10,
        e.abs()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn exp(status: ExperimentStatus, started: Option<&str>) -> Experiment {
        Experiment {
            status,
            started_at: started.map(str::to_owned),
            created_at: "1970-01-01T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn metric_value_follows_js_bands_and_rounding() {
        assert_eq!(format_metric_value("m", f64::NAN), "—");
        assert_eq!(format_metric_value("m", 0.0), "0");
        assert_eq!(format_metric_value("m", -0.0), "0");
        assert_eq!(format_metric_value("m", 1_234_567.0), "1.23e+6");
        assert_eq!(format_metric_value("m", 0.00001), "1.00e-5");
        assert_eq!(format_metric_value("m", 9.996e-5), "1.00e-4");
        assert_eq!(format_metric_value("m", 0.001), "1.00e-3");
        assert_eq!(format_metric_value("m", 150.25), "150.3");
        assert_eq!(format_metric_value("m", 1.0625), "1.063");
        assert_eq!(format_metric_value("m", 9.9999), "10.000");
        assert_eq!(format_metric_value("m", -2.5), "-2.500");
        assert_eq!(format_metric_value("m", 0.5), "0.5000");
        assert_eq!(format_metric_value("m", 0.012345), "0.0123");
    }

    #[test]
    fn metric_cell_shows_values_not_objects() {
        assert_eq!(format_metric_cell("m", &Value::Null), "—");
        assert_eq!(format_metric_cell("m", &json!("  ")), "—");
        assert_eq!(format_metric_cell("m", &json!("1.5")), "1.500");
        assert_eq!(format_metric_cell("m", &json!("abc")), "abc");
        assert_eq!(format_metric_cell("m", &json!(true)), "true");
        assert_eq!(
            format_metric_cell("m", &json!({"a": 1.0, "b": [true, null, "x"]})),
            r#"{"a":1,"b":[true,null,"x"]}"#
        );
    }

    #[test]
    fn js_number_strings_match_to_string() {
        assert_eq!(js_number_string(123.0), "123");
        assert_eq!(js_number_string(1e20), "100000000000000000000");
        assert_eq!(js_number_string(1e21), "1e+21");
        assert_eq!(js_number_string(0.000001), "0.000001");
        assert_eq!(js_number_string(1e-7), "1e-7");
        assert_eq!(js_number_string(-1.5), "-1.5");
    }

    #[test]
    fn iso_timestamps_parse_with_zone_only() {
        assert!(
            parse_iso_utc_ms("1970-01-01T00:00:01.5Z")
                .is_some_and(|v| (v - 1500.0).abs() < f64::EPSILON)
        );
        assert!(
            parse_iso_utc_ms("2024-01-01T00:00:00Z")
                .is_some_and(|v| (v - 1_704_067_200_000.0).abs() < f64::EPSILON)
        );
        assert!(parse_iso_utc_ms("2024-02-29T00:00:00Z").is_some());
        assert_eq!(parse_iso_utc_ms("2023-02-29T00:00:00Z"), None);
        assert_eq!(parse_iso_utc_ms("yesterday"), None);
        // PostgREST's timestamptz form, offsets, short forms; no zone means local, so None.
        assert_eq!(
            parse_iso_utc_ms("1970-01-01T01:00:00.123456+01:00"),
            Some(123.0)
        );
        assert_eq!(
            parse_iso_utc_ms("1970-01-01T00:00-00:30"),
            Some(1_800_000.0)
        );
        assert_eq!(parse_iso_utc_ms("1970-01-02"), Some(86_400_000.0));
        assert_eq!(parse_iso_utc_ms("1970-01-01T00:00:00"), None);
        assert_eq!(parse_iso_utc_ms("1970-01-01T00:00:00+0100"), None);
        assert!(
            experiment_activity_at(&exp(ExperimentStatus::Planned, Some("nope"))).abs()
                < f64::EPSILON
        );
    }

    #[test]
    fn stale_running_uses_latest_activity() {
        let running = exp(ExperimentStatus::Running, Some("1970-01-01T00:00:01Z"));
        assert!(!is_stale_running_experiment(
            &running,
            120_999.0,
            STALE_RUNNING_MS,
            None
        ));
        assert!(is_stale_running_experiment(
            &running,
            121_000.0,
            STALE_RUNNING_MS,
            None
        ));
        assert!(!is_stale_running_experiment(
            &running,
            121_000.0,
            STALE_RUNNING_MS,
            Some(61_000.0)
        ));
        let planned = exp(ExperimentStatus::Planned, Some("1970-01-01T00:00:01Z"));
        assert!(!is_stale_running_experiment(
            &planned,
            1e12,
            STALE_RUNNING_MS,
            None
        ));
    }

    #[test]
    fn status_patch_stamps_and_clears_finish() {
        let running = exp(ExperimentStatus::Running, Some("2024-01-01T00:00:00Z"));
        let failed =
            status_patch_for_experiment(&running, ExperimentStatus::Failed, "2024-01-02T00:00:00Z");
        assert_eq!(failed.finished_at.as_deref(), Some("2024-01-02T00:00:00Z"));
        assert_eq!(failed.started_at.as_deref(), Some("2024-01-01T00:00:00Z"));
        let restarted = status_patch_for_experiment(
            &exp(ExperimentStatus::Failed, Some("2024-01-01T00:00:00Z")),
            ExperimentStatus::Running,
            "t",
        );
        assert_eq!(restarted.finished_at, None);
        assert_eq!(
            restarted.started_at.as_deref(),
            Some("2024-01-01T00:00:00Z")
        );
        let fresh = status_patch_for_experiment(
            &exp(ExperimentStatus::Planned, Some("")),
            ExperimentStatus::Running,
            "now",
        );
        assert_eq!(fresh.started_at.as_deref(), Some("now"));
    }

    #[test]
    fn short_sha_trims_then_cuts_seven() {
        assert_eq!(short_sha(Some("0123456789ab")), Some("0123456".to_owned()));
        assert_eq!(short_sha(Some("  abc  ")), Some("abc".to_owned()));
        assert_eq!(short_sha(Some("")), None);
        assert_eq!(short_sha(None), None);
    }
}
