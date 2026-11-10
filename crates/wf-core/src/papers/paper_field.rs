//! Custom paper-field kinds and the rollup config encoded in field `options`
//! (TS `features/papers/domain/paper-field.ts`). Pure, no I/O.

use std::collections::HashSet;

use crate::search::js_text::is_js_whitespace;

/// Supported custom field kinds on papers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum PaperFieldKind {
    /// Free text.
    Text,
    /// A finite number.
    Number,
    /// One option from a list.
    Select,
    /// Several options from a list.
    MultiSelect,
    /// Links to other papers.
    Relation,
    /// Computed from a relation.
    Rollup,
}

/// Every `PaperFieldKind`, in the order TS lists them.
pub const PAPER_FIELD_KINDS: &[PaperFieldKind] = &[
    PaperFieldKind::Text,
    PaperFieldKind::Number,
    PaperFieldKind::Select,
    PaperFieldKind::MultiSelect,
    PaperFieldKind::Relation,
    PaperFieldKind::Rollup,
];

/// Aggregation a rollup field applies to its related papers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum PaperFieldRollupAgg {
    /// Number of related papers.
    Count,
    /// The related values, listed.
    Values,
    /// Sum of the related values.
    Sum,
    /// Mean of the related values.
    Avg,
}

/// Rollup config encoded in `options` for kind=rollup.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperFieldRollupConfig {
    /// Id of the relation field to follow.
    pub relation_field_id: String,
    /// How the related values are combined.
    pub agg: PaperFieldRollupAgg,
    /// Required for values/sum/avg: the related paper's field to aggregate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_field_id: Option<String>,
}

impl PaperFieldKind {
    /// The wire string TS uses for this kind.
    const fn name(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Number => "number",
            Self::Select => "select",
            Self::MultiSelect => "multi_select",
            Self::Relation => "relation",
            Self::Rollup => "rollup",
        }
    }
}

impl PaperFieldRollupAgg {
    /// The wire string TS uses for this aggregation.
    const fn name(self) -> &'static str {
        match self {
            Self::Count => "count",
            Self::Values => "values",
            Self::Sum => "sum",
            Self::Avg => "avg",
        }
    }

    /// Reads an aggregation from its wire string, or `None` when unknown.
    fn from_name(value: &str) -> Option<Self> {
        match value {
            "count" => Some(Self::Count),
            "values" => Some(Self::Values),
            "sum" => Some(Self::Sum),
            "avg" => Some(Self::Avg),
            _ => None,
        }
    }
}

/// A field name with its outer whitespace dropped and each inner whitespace run collapsed to one space
/// (TS `normalizeName`: `trim()` then `replace(/\s+/g, " ")`).
#[must_use]
pub fn normalize_field_name(raw: &str) -> String {
    let mut out = String::new();
    for word in raw.split(is_js_whitespace).filter(|word| !word.is_empty()) {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(word);
    }
    out
}

/// Trims each select option, drops blanks, and keeps the first of each spelling that differs only by case
/// (TS `normalizeOptions` for select and multi-select kinds).
#[must_use]
pub fn normalize_select_options(raw: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    raw.iter()
        .map(|item| item.trim_matches(is_js_whitespace))
        .filter(|item| !item.is_empty())
        .filter(|item| seen.insert(item.to_lowercase()))
        .map(str::to_owned)
        .collect()
}

/// Whether `value` is one of the wire strings in `PAPER_FIELD_KINDS`.
#[must_use]
pub fn is_paper_field_kind(value: &str) -> bool {
    PAPER_FIELD_KINDS.iter().any(|kind| kind.name() == value)
}

/// Encodes a rollup config as `rel:`, `agg:` and optional `src:` tokens.
#[must_use]
pub fn encode_rollup_options(config: &PaperFieldRollupConfig) -> Vec<String> {
    let mut out = vec![
        format!("rel:{}", config.relation_field_id),
        format!("agg:{}", config.agg.name()),
    ];
    if let Some(source) = config.source_field_id.as_deref().filter(|s| !s.is_empty()) {
        out.push(format!("src:{source}"));
    }
    out
}

/// Reads a rollup config from option tokens; last token of each kind wins.
///
/// `None` when the relation is missing or the aggregation is absent or unknown.
#[must_use]
pub fn parse_rollup_options(options: &[String]) -> Option<PaperFieldRollupConfig> {
    let mut relation = "";
    let mut agg_token = None;
    let mut source = None;
    for token in options {
        if let Some(value) = token.strip_prefix("rel:") {
            relation = value;
        } else if let Some(value) = token.strip_prefix("agg:") {
            agg_token = Some(value);
        } else if let Some(value) = token.strip_prefix("src:") {
            source = Some(value.to_owned());
        }
    }
    if relation.is_empty() {
        return None;
    }
    let agg = PaperFieldRollupAgg::from_name(agg_token?)?;
    Some(PaperFieldRollupConfig {
        relation_field_id: relation.to_owned(),
        agg,
        source_field_id: source,
    })
}

/// A paper field value as an AI tool or draft sends it, before it is checked.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(untagged)]
pub enum PaperFieldValueInput {
    /// A string.
    Text(String),
    /// A number; NaN and the infinities are refused by [`parse_paper_field_value`].
    Number(f64),
    /// A string list; every item must be a string.
    List(Vec<String>),
}

/// A checked paper field value: a string, a finite number or a string list.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum PaperFieldValueData {
    /// A non-blank string, kept as sent.
    Text(String),
    /// A finite number.
    Number(f64),
    /// A list with blanks trimmed away and at least one item.
    List(Vec<String>),
}

/// The refusal message for `name`, the caller's label (e.g. `value` or `Proposal value`).
#[must_use]
pub fn paper_field_value_refusal(name: &str) -> String {
    format!("{name} must be a non-empty string, number, or non-empty string list.")
}

/// Read a field value sent from outside (TS `parsePaperFieldValue`): a non-blank string
/// (kept as sent), a finite number, or a string list with blanks trimmed away.
/// Anything else is refused with [`paper_field_value_refusal`].
pub fn parse_paper_field_value(
    input: PaperFieldValueInput,
    name: &str,
) -> Result<PaperFieldValueData, String> {
    match input {
        PaperFieldValueInput::Text(text) if !text.trim().is_empty() => {
            Ok(PaperFieldValueData::Text(text))
        }
        PaperFieldValueInput::Number(number) if number.is_finite() => {
            Ok(PaperFieldValueData::Number(number))
        }
        PaperFieldValueInput::List(items) => {
            let cleaned: Vec<String> = items
                .iter()
                .map(|item| item.trim())
                .filter(|item| !item.is_empty())
                .map(str::to_owned)
                .collect();
            if cleaned.is_empty() {
                Err(paper_field_value_refusal(name))
            } else {
                Ok(PaperFieldValueData::List(cleaned))
            }
        }
        _ => Err(paper_field_value_refusal(name)),
    }
}

const ROLLUP_READ_ONLY: &str = "Rollup fields are computed and read-only.";

/// The value `setValue` stores for `raw` on a field of `kind` (TS `ManagePaperFieldsUseCase`).
///
/// `Ok(None)` clears the stored value: `raw` is absent, blank text, or an empty list. Text and
/// select take one string, trimmed. Number takes a finite number, or text (or a list, joined with
/// commas) read the way JS `Number()` reads it. Multi-select and relation take a string list,
/// trimmed, with blanks and repeats dropped.
/// Rollup fields are computed, so they are always refused.
///
/// # Errors
///
/// Returns the refusal message for a value of the wrong shape, or for a rollup field.
pub fn coerce_paper_field_value(
    kind: PaperFieldKind,
    raw: Option<PaperFieldValueInput>,
) -> Result<Option<PaperFieldValueData>, String> {
    if kind == PaperFieldKind::Rollup {
        return Err(ROLLUP_READ_ONLY.to_owned());
    }
    let raw = match raw {
        None => return Ok(None),
        Some(PaperFieldValueInput::Text(text))
            if text.trim_matches(is_js_whitespace).is_empty() =>
        {
            return Ok(None);
        }
        Some(PaperFieldValueInput::List(items)) if items.is_empty() => return Ok(None),
        Some(raw) => raw,
    };
    match (kind, raw) {
        (PaperFieldKind::Text | PaperFieldKind::Select, PaperFieldValueInput::Text(text)) => {
            Ok(Some(PaperFieldValueData::Text(
                text.trim_matches(is_js_whitespace).to_owned(),
            )))
        }
        (PaperFieldKind::Text | PaperFieldKind::Select, _) => {
            Err(format!("Field kind \"{}\" expects a string.", kind.name()))
        }
        (PaperFieldKind::Number, PaperFieldValueInput::Number(number)) => finite_number(number),
        (PaperFieldKind::Number, PaperFieldValueInput::Text(text)) => {
            finite_number(js_number(&text))
        }
        (PaperFieldKind::Number, PaperFieldValueInput::List(items)) => {
            finite_number(js_number(&items.join(",")))
        }
        (
            PaperFieldKind::MultiSelect | PaperFieldKind::Relation,
            PaperFieldValueInput::List(items),
        ) => {
            let mut seen = HashSet::new();
            let cleaned = items
                .iter()
                .map(|item| item.trim_matches(is_js_whitespace))
                .filter(|item| !item.is_empty())
                .filter(|item| seen.insert(*item))
                .map(str::to_owned)
                .collect();
            Ok(Some(PaperFieldValueData::List(cleaned)))
        }
        (PaperFieldKind::MultiSelect | PaperFieldKind::Relation, _) => {
            Err(format!("{} expects a string array.", kind.name()))
        }
        (PaperFieldKind::Rollup, _) => Err(ROLLUP_READ_ONLY.to_owned()),
    }
}

fn finite_number(number: f64) -> Result<Option<PaperFieldValueData>, String> {
    if number.is_finite() {
        Ok(Some(PaperFieldValueData::Number(number)))
    } else {
        Err("Value must be a finite number.".to_owned())
    }
}

/// JS `Number(text)`: surrounding JS whitespace is ignored and blank is 0. `0x`, `0o` and `0b`
/// (either case, no sign) read hex, octal and binary. Any other text must be a decimal literal,
/// and anything else is NaN.
fn js_number(text: &str) -> f64 {
    let trimmed = text.trim_matches(is_js_whitespace);
    if trimmed.is_empty() {
        return 0.0;
    }
    let radix = match trimmed.get(..2) {
        Some(prefix) if prefix.eq_ignore_ascii_case("0x") => 16,
        Some(prefix) if prefix.eq_ignore_ascii_case("0o") => 8,
        Some(prefix) if prefix.eq_ignore_ascii_case("0b") => 2,
        _ => return trimmed.parse::<f64>().unwrap_or(f64::NAN),
    };
    parse_radix_digits(&trimmed[2..], radix)
}

/// Digits in `radix` as a number: exact while it fits in `u128`, else the rounded running value.
fn parse_radix_digits(digits: &str, radix: u32) -> f64 {
    if digits.is_empty() {
        return f64::NAN;
    }
    let mut exact: Option<u128> = Some(0);
    let mut approx = 0.0_f64;
    for ch in digits.chars() {
        let Some(digit) = ch.to_digit(radix) else {
            return f64::NAN;
        };
        approx = approx * f64::from(radix) + f64::from(digit);
        exact = exact
            .and_then(|value| value.checked_mul(u128::from(radix)))
            .and_then(|value| value.checked_add(u128::from(digit)));
    }
    exact.map_or(approx, |value| value as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_name_and_select_options_normalise_like_the_ts_version() {
        assert_eq!(normalize_field_name("  Cell   type \t x "), "Cell type x");
        assert_eq!(normalize_field_name("   "), "");
        let raw: Vec<String> = [" Red ", "red", "", "  ", "Blue", "BLUE", "green"]
            .iter()
            .map(|item| (*item).to_owned())
            .collect();
        assert_eq!(normalize_select_options(&raw), vec!["Red", "Blue", "green"]);
    }

    #[test]
    fn coerce_checks_each_kind_like_the_ts_setter() {
        let text = |s: &str| Some(PaperFieldValueInput::Text(s.to_owned()));
        let list = |items: &[&str]| {
            Some(PaperFieldValueInput::List(
                items.iter().map(|s| (*s).to_owned()).collect(),
            ))
        };
        assert_eq!(
            coerce_paper_field_value(PaperFieldKind::Text, text("  VAE  ")),
            Ok(Some(PaperFieldValueData::Text("VAE".to_owned())))
        );
        assert_eq!(
            coerce_paper_field_value(PaperFieldKind::Text, text("   ")),
            Ok(None)
        );
        assert_eq!(
            coerce_paper_field_value(PaperFieldKind::Text, None),
            Ok(None)
        );
        assert_eq!(
            coerce_paper_field_value(
                PaperFieldKind::Text,
                Some(PaperFieldValueInput::Number(1.0))
            ),
            Err("Field kind \"text\" expects a string.".to_owned())
        );
        assert_eq!(
            coerce_paper_field_value(PaperFieldKind::Number, text(" 1.5 ")),
            Ok(Some(PaperFieldValueData::Number(1.5)))
        );
        assert_eq!(
            coerce_paper_field_value(
                PaperFieldKind::Number,
                Some(PaperFieldValueInput::Number(2.0))
            ),
            Ok(Some(PaperFieldValueData::Number(2.0)))
        );
        assert!(coerce_paper_field_value(PaperFieldKind::Number, text("abc")).is_err());
        assert!(coerce_paper_field_value(PaperFieldKind::Number, text("inf")).is_err());
        assert!(
            coerce_paper_field_value(
                PaperFieldKind::Number,
                Some(PaperFieldValueInput::Number(f64::NAN))
            )
            .is_err()
        );
        assert_eq!(
            coerce_paper_field_value(PaperFieldKind::MultiSelect, list(&[" a ", "a", "", "b"])),
            Ok(Some(PaperFieldValueData::List(vec![
                "a".to_owned(),
                "b".to_owned()
            ])))
        );
        assert_eq!(
            coerce_paper_field_value(PaperFieldKind::Relation, list(&[])),
            Ok(None)
        );
        assert_eq!(
            coerce_paper_field_value(PaperFieldKind::Relation, list(&["  "])),
            Ok(Some(PaperFieldValueData::List(Vec::new())))
        );
        assert_eq!(
            coerce_paper_field_value(PaperFieldKind::Relation, text("p1")),
            Err("relation expects a string array.".to_owned())
        );
        assert_eq!(
            coerce_paper_field_value(PaperFieldKind::Rollup, None),
            Err(ROLLUP_READ_ONLY.to_owned())
        );
    }

    #[test]
    fn number_coercion_reads_text_and_lists_like_js_number() {
        let number =
            |raw: PaperFieldValueInput| coerce_paper_field_value(PaperFieldKind::Number, Some(raw));
        let text = |s: &str| number(PaperFieldValueInput::Text(s.to_owned()));
        let list = |items: &[&str]| number(PaperFieldValueInput::List(tokens(items)));
        let ok = |n: f64| Ok(Some(PaperFieldValueData::Number(n)));

        // Hex, octal and binary prefixes, either case, with surrounding whitespace.
        assert_eq!(text("0x1F"), ok(31.0));
        assert_eq!(text("0X1f"), ok(31.0));
        assert_eq!(text(" 0o17 "), ok(15.0));
        assert_eq!(text("0b101"), ok(5.0));
        assert_eq!(text("0xFFFFFFFFFFFFFFFF"), ok(18_446_744_073_709_551_615.0));
        // Prefixes take no sign, and a prefix needs digits.
        assert!(text("-0x1F").is_err());
        assert!(text("+0b1").is_err());
        assert!(text("0x").is_err());
        assert!(text("0x1G").is_err());
        assert!(text("0b2").is_err());
        // Decimal forms JS accepts; Infinity and NaN are refused.
        assert_eq!(text("1e3"), ok(1000.0));
        assert_eq!(text(".5"), ok(0.5));
        assert_eq!(text("5."), ok(5.0));
        assert_eq!(text("+7"), ok(7.0));
        assert!(text("Infinity").is_err());
        assert!(text("NaN").is_err());
        // A list is joined with commas first, as String(array) does.
        assert_eq!(list(&["5"]), ok(5.0));
        assert_eq!(list(&[" 5 "]), ok(5.0));
        assert_eq!(list(&["0x10"]), ok(16.0));
        assert_eq!(list(&[""]), ok(0.0));
        assert!(list(&["1", "2"]).is_err());
        assert!(list(&["1,2"]).is_err());
    }

    fn tokens(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn kind_guard_accepts_only_known_wire_strings() {
        for kind in PAPER_FIELD_KINDS {
            assert!(is_paper_field_kind(kind.name()));
        }
        assert!(is_paper_field_kind("multi_select"));
        assert!(!is_paper_field_kind("Text"));
        assert!(!is_paper_field_kind("multiSelect"));
        assert!(!is_paper_field_kind(""));
    }

    #[test]
    fn encode_writes_relation_agg_and_source() {
        let config = PaperFieldRollupConfig {
            relation_field_id: "r1".to_owned(),
            agg: PaperFieldRollupAgg::Sum,
            source_field_id: Some("f2".to_owned()),
        };
        assert_eq!(
            encode_rollup_options(&config),
            tokens(&["rel:r1", "agg:sum", "src:f2"])
        );
    }

    #[test]
    fn encode_omits_absent_or_empty_source() {
        let config = PaperFieldRollupConfig {
            relation_field_id: "r1".to_owned(),
            agg: PaperFieldRollupAgg::Count,
            source_field_id: Some(String::new()),
        };
        assert_eq!(
            encode_rollup_options(&config),
            tokens(&["rel:r1", "agg:count"])
        );
    }

    #[test]
    fn parse_round_trips_encode() {
        let config = PaperFieldRollupConfig {
            relation_field_id: "r1".to_owned(),
            agg: PaperFieldRollupAgg::Avg,
            source_field_id: Some("f2".to_owned()),
        };
        let encoded = encode_rollup_options(&config);
        assert_eq!(parse_rollup_options(&encoded), Some(config));
    }

    #[test]
    fn parse_needs_a_non_empty_relation() {
        assert_eq!(parse_rollup_options(&tokens(&["agg:count"])), None);
        assert_eq!(parse_rollup_options(&tokens(&["rel:", "agg:count"])), None);
    }

    #[test]
    fn parse_rejects_unknown_or_missing_agg() {
        assert_eq!(parse_rollup_options(&tokens(&["rel:r1"])), None);
        assert_eq!(
            parse_rollup_options(&tokens(&["rel:r1", "agg:sum", "agg:median"])),
            None
        );
    }

    #[test]
    fn parse_last_token_wins_and_ignores_unknown() {
        let parsed = parse_rollup_options(&tokens(&[
            "rel:old",
            "other:x",
            "rel:r1",
            "src:a",
            "src:b",
            "agg:values",
        ]));
        assert_eq!(
            parsed,
            Some(PaperFieldRollupConfig {
                relation_field_id: "r1".to_owned(),
                agg: PaperFieldRollupAgg::Values,
                source_field_id: Some("b".to_owned()),
            })
        );
    }

    #[test]
    fn field_value_passes_text_numbers_and_trimmed_lists() {
        assert_eq!(
            parse_paper_field_value(PaperFieldValueInput::Text("VAE".to_owned()), "value"),
            Ok(PaperFieldValueData::Text("VAE".to_owned()))
        );
        assert_eq!(
            parse_paper_field_value(PaperFieldValueInput::Number(0.0), "value"),
            Ok(PaperFieldValueData::Number(0.0))
        );
        assert_eq!(
            parse_paper_field_value(
                PaperFieldValueInput::List(tokens(&[" a ", "", "b"])),
                "value"
            ),
            Ok(PaperFieldValueData::List(tokens(&["a", "b"])))
        );
    }

    #[test]
    fn field_value_refuses_blank_and_non_finite_with_caller_name() {
        let message =
            "Proposal value must be a non-empty string, number, or non-empty string list.";
        let refused = [
            PaperFieldValueInput::Text("  ".to_owned()),
            PaperFieldValueInput::List(Vec::new()),
            PaperFieldValueInput::List(tokens(&["", " "])),
            PaperFieldValueInput::Number(f64::NAN),
            PaperFieldValueInput::Number(f64::INFINITY),
            PaperFieldValueInput::Number(f64::NEG_INFINITY),
        ];
        for bad in refused {
            assert_eq!(
                parse_paper_field_value(bad, "Proposal value"),
                Err(message.to_owned())
            );
        }
    }

    #[test]
    fn field_value_input_shapes_refuse_null_objects_and_non_string_items() {
        for json in ["null", "true", "{}", "[1]", "[null]", "[[\"a\"]]"] {
            assert!(
                serde_json::from_str::<PaperFieldValueInput>(json).is_err(),
                "{json} should be refused"
            );
        }
    }
}
