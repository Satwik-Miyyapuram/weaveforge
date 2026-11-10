//! Field readers for an AI proposal payload (TS `object`, `text`, `optionalText`,
//! `optionalNumber`, `record`, `stringArray`, `enumValue` and `optionalYear` in
//! `apps/web/src/features/ai-assistant/application/proposal-executors.ts`).
//!
//! Each reader returns the TS error message verbatim when it refuses a value.

use serde_json::{Map, Value};

use crate::search::js_text::is_js_whitespace;

/// JS `String.prototype.trim`.
#[must_use]
pub fn js_trim(value: &str) -> &str {
    value.trim_matches(is_js_whitespace)
}

/// The payload as an object. Missing, null, array and scalar payloads are refused.
pub fn object(payload: &Value) -> Result<&Map<String, Value>, String> {
    match payload {
        Value::Object(map) => Ok(map),
        _ => Err("Proposal payload is missing or invalid.".to_owned()),
    }
}

/// A required string, trimmed. Absent, non-string or blank is refused.
pub fn text(map: &Map<String, Value>, key: &str) -> Result<String, String> {
    match map.get(key).and_then(Value::as_str).map(js_trim) {
        Some(value) if !value.is_empty() => Ok(value.to_owned()),
        _ => Err(format!("Proposal {key} is required.")),
    }
}

/// An optional string, trimmed. Absent, non-string or blank gives `None`.
#[must_use]
pub fn optional_text(map: &Map<String, Value>, key: &str) -> Option<String> {
    map.get(key)
        .and_then(Value::as_str)
        .map(js_trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// An optional finite number. Absent gives `None`; present but not a number (null included) is refused.
pub fn optional_number(map: &Map<String, Value>, key: &str) -> Result<Option<f64>, String> {
    match map.get(key) {
        None => Ok(None),
        Some(Value::Number(number)) => number
            .as_f64()
            .filter(|value| value.is_finite())
            .map(Some)
            .ok_or_else(|| number_error(key)),
        Some(_) => Err(number_error(key)),
    }
}

/// An optional list of strings, untrimmed. Absent gives `None`; any non-string item is refused.
pub fn string_list(map: &Map<String, Value>, key: &str) -> Result<Option<Vec<String>>, String> {
    match map.get(key) {
        None => Ok(None),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| {
                item.as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| list_error(key))
            })
            .collect::<Result<Vec<String>, String>>()
            .map(Some),
        Some(_) => Err(list_error(key)),
    }
}

/// An optional value from `allowed`. Absent gives `None`; anything else outside the list is refused.
pub fn enum_value(
    map: &Map<String, Value>,
    key: &str,
    allowed: &[&'static str],
) -> Result<Option<&'static str>, String> {
    match map.get(key) {
        None => Ok(None),
        Some(Value::String(value)) => allowed
            .iter()
            .copied()
            .find(|candidate| *candidate == value.as_str())
            .map(Some)
            .ok_or_else(|| format!("Proposal {key} is invalid.")),
        Some(_) => Err(format!("Proposal {key} is invalid.")),
    }
}

/// A nested object field. Anything but a plain object is refused.
pub fn record<'a>(
    map: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a Map<String, Value>, String> {
    match map.get(key) {
        Some(Value::Object(inner)) => Ok(inner),
        _ => Err(format!("Proposal {key} must be an object.")),
    }
}

/// A whole year, given as a number or as digits. Absent, null or blank gives `None`.
pub fn optional_year(map: &Map<String, Value>, key: &str) -> Result<Option<f64>, String> {
    let parsed = match map.get(key) {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::String(raw)) if js_trim(raw).is_empty() => return Ok(None),
        Some(Value::String(raw)) => {
            let digits = js_trim(raw);
            if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err(year_error(key));
            }
            digits.parse::<f64>().map_err(|_| year_error(key))?
        }
        Some(Value::Number(number)) => number.as_f64().ok_or_else(|| year_error(key))?,
        Some(_) => return Err(year_error(key)),
    };
    if parsed.is_finite() && parsed.fract() == 0.0 {
        Ok(Some(parsed))
    } else {
        Err(year_error(key))
    }
}

fn number_error(key: &str) -> String {
    format!("Proposal {key} must be a number.")
}

fn list_error(key: &str) -> String {
    format!("Proposal {key} must be a string list.")
}

fn year_error(key: &str) -> String {
    format!("Proposal {key} must be a whole year.")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn map(value: &Value) -> &Map<String, Value> {
        value.as_object().expect("test payload is an object")
    }

    #[test]
    fn payload_must_be_an_object() {
        assert_eq!(
            object(&json!(null)).unwrap_err(),
            "Proposal payload is missing or invalid."
        );
        assert!(object(&json!(["a"])).is_err());
        assert!(object(&json!("text")).is_err());
        assert!(object(&json!({})).is_ok());
    }

    #[test]
    fn required_text_is_trimmed_and_refused_when_blank() {
        let value = json!({"title": "  Hello  ", "blank": "   ", "num": 3});
        assert_eq!(text(map(&value), "title").unwrap(), "Hello");
        assert_eq!(
            text(map(&value), "blank").unwrap_err(),
            "Proposal blank is required."
        );
        assert_eq!(
            text(map(&value), "num").unwrap_err(),
            "Proposal num is required."
        );
        assert_eq!(
            text(map(&value), "missing").unwrap_err(),
            "Proposal missing is required."
        );
    }

    #[test]
    fn optional_text_drops_blank_and_non_string() {
        let value = json!({"a": " x ", "b": "  ", "c": 1});
        assert_eq!(optional_text(map(&value), "a").as_deref(), Some("x"));
        assert_eq!(optional_text(map(&value), "b"), None);
        assert_eq!(optional_text(map(&value), "c"), None);
    }

    #[test]
    fn optional_number_refuses_null_and_non_numbers() {
        let value = json!({"n": 4, "bad": "4", "nil": null});
        assert_eq!(optional_number(map(&value), "n").unwrap(), Some(4.0));
        assert_eq!(optional_number(map(&value), "absent").unwrap(), None);
        assert_eq!(
            optional_number(map(&value), "bad").unwrap_err(),
            "Proposal bad must be a number."
        );
        assert_eq!(
            optional_number(map(&value), "nil").unwrap_err(),
            "Proposal nil must be a number."
        );
    }

    #[test]
    fn string_list_keeps_items_untrimmed_and_refuses_mixed_items() {
        let value = json!({"tags": [" a ", "b"], "mixed": ["a", 1], "scalar": "a"});
        assert_eq!(
            string_list(map(&value), "tags").unwrap(),
            Some(vec![" a ".to_owned(), "b".to_owned()])
        );
        assert_eq!(string_list(map(&value), "absent").unwrap(), None);
        assert_eq!(
            string_list(map(&value), "mixed").unwrap_err(),
            "Proposal mixed must be a string list."
        );
        assert_eq!(
            string_list(map(&value), "scalar").unwrap_err(),
            "Proposal scalar must be a string list."
        );
    }

    #[test]
    fn enum_value_accepts_listed_values_only() {
        let value = json!({"s": "done", "bad": "someday", "num": 1});
        let allowed = ["planned", "done"];
        assert_eq!(
            enum_value(map(&value), "s", &allowed).unwrap(),
            Some("done")
        );
        assert_eq!(enum_value(map(&value), "absent", &allowed).unwrap(), None);
        assert_eq!(
            enum_value(map(&value), "bad", &allowed).unwrap_err(),
            "Proposal bad is invalid."
        );
        assert_eq!(
            enum_value(map(&value), "num", &allowed).unwrap_err(),
            "Proposal num is invalid."
        );
    }

    #[test]
    fn record_requires_a_plain_object() {
        let value = json!({"m": {"acc": 0.9}, "arr": [1], "nil": null});
        assert!(record(map(&value), "m").is_ok());
        assert_eq!(
            record(map(&value), "arr").unwrap_err(),
            "Proposal arr must be an object."
        );
        assert_eq!(
            record(map(&value), "nil").unwrap_err(),
            "Proposal nil must be an object."
        );
    }

    #[test]
    fn optional_year_accepts_whole_years_and_digit_strings() {
        let value = json!({"n": 2021, "s": " 2021 ", "blank": "  ", "nil": null, "frac": 20.5, "word": "soon", "flag": true, "neg": "-3"});
        assert_eq!(optional_year(map(&value), "n").unwrap(), Some(2021.0));
        assert_eq!(optional_year(map(&value), "s").unwrap(), Some(2021.0));
        assert_eq!(optional_year(map(&value), "blank").unwrap(), None);
        assert_eq!(optional_year(map(&value), "nil").unwrap(), None);
        assert_eq!(optional_year(map(&value), "absent").unwrap(), None);
        assert_eq!(
            optional_year(map(&value), "frac").unwrap_err(),
            "Proposal frac must be a whole year."
        );
        assert_eq!(
            optional_year(map(&value), "word").unwrap_err(),
            "Proposal word must be a whole year."
        );
        assert_eq!(
            optional_year(map(&value), "flag").unwrap_err(),
            "Proposal flag must be a whole year."
        );
        assert_eq!(
            optional_year(map(&value), "neg").unwrap_err(),
            "Proposal neg must be a whole year."
        );
    }
}
