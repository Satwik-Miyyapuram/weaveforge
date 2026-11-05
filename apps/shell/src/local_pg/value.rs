//! Converts Postgres text-format values to the JSON shape PGlite returned, and JSON params to the
//! text PGlite sent.

use super::{Column, PgError, TextRows};
use base64::Engine;
use serde_json::Value;

/// Converts one text-format cell to the JSON value PGlite returned for its type OID.
#[must_use]
pub fn cell_to_json(text: &str, type_oid: u32) -> Value {
    if let Some(elem_oid) = array_element_oid(type_oid) {
        return parse_array(text, elem_oid).unwrap_or_else(|| text_value(text));
    }
    match type_oid {
        21 | 23 | 26 | 20 => match text.parse::<i64>() {
            Ok(n) => Value::from(n),
            Err(_) => text_value(text),
        },
        // NaN and infinities have no JSON form, so `from_f64` gives None and they become null.
        700 | 701 => match text.parse::<f64>() {
            Ok(f) => serde_json::Number::from_f64(f).map_or(Value::Null, Value::Number),
            Err(_) => text_value(text),
        },
        16 => match text {
            "t" => Value::Bool(true),
            "f" => Value::Bool(false),
            _ => text_value(text),
        },
        114 | 3802 => serde_json::from_str(text).unwrap_or_else(|_| text_value(text)),
        17 => bytea_value(text),
        1184 | 1114 => timestamp_value(text),
        _ => text_value(text),
    }
}

/// The element OID of an array type, or `None` if the OID is not a known array type.
#[must_use]
pub fn array_element_oid(array_oid: u32) -> Option<u32> {
    Some(match array_oid {
        1005 => 21,
        1007 => 23,
        1016 => 20,
        1028 => 26,
        1021 => 700,
        1022 => 701,
        1231 => 1700,
        1000 => 16,
        199 => 114,
        3807 => 3802,
        1001 => 17,
        1182 => 1082,
        1115 => 1114,
        1185 => 1184,
        1009 => 25,
        1015 => 1043,
        1014 => 1042,
        1002 => 18,
        2951 => 2950,
        1041 => 869,
        _ => return None,
    })
}

/// Converts a Postgres text-format param to the text the server expects, for the param's type OID.
/// `None` is SQL null.
pub fn param_to_text(value: &Value, type_oid: u32) -> Result<Option<String>, PgError> {
    if value.is_null() {
        return Ok(None);
    }
    if let Some(text) = tagged_text(value)? {
        return Ok(Some(text));
    }
    match type_oid {
        114 | 3802 => json_text(value),
        16 => bool_text(value),
        17 => bytea_text(value),
        1082 | 1114 | 1184 => timestamp_text(value),
        _ => match (array_element_oid(type_oid), value) {
            (Some(elem_oid), Value::Array(items)) => array_literal(items, elem_oid).map(Some),
            (Some(_), Value::String(s)) => Ok(Some(s.clone())),
            _ => default_text(value),
        },
    }
}

/// Parses a Postgres array literal, such as `[0:1]={1,2}`, into a JSON array; `None` if malformed.
fn parse_array(text: &str, elem_oid: u32) -> Option<Value> {
    let body = if text.starts_with('[') {
        text.split_once('=')?.1
    } else {
        text
    };
    let chars: Vec<char> = body.chars().collect();
    let mut pos = 0;
    let value = parse_braced(&chars, &mut pos, elem_oid)?;
    if pos == chars.len() {
        Some(value)
    } else {
        None
    }
}

/// Parses `{...}` starting at `pos`, leaving `pos` just after the closing brace.
fn parse_braced(chars: &[char], pos: &mut usize, elem_oid: u32) -> Option<Value> {
    if chars.get(*pos) != Some(&'{') {
        return None;
    }
    *pos += 1;
    let mut items = Vec::new();
    if chars.get(*pos) == Some(&'}') {
        *pos += 1;
        return Some(Value::Array(items));
    }
    loop {
        let item = if chars.get(*pos).copied()? == '{' {
            parse_braced(chars, pos, elem_oid)?
        } else {
            parse_element(chars, pos, elem_oid)?
        };
        items.push(item);
        match chars.get(*pos).copied()? {
            ',' => *pos += 1,
            '}' => {
                *pos += 1;
                return Some(Value::Array(items));
            }
            _ => return None,
        }
    }
}

/// Parses one array element (quoted or not), leaving `pos` at the `,` or `}` after it.
fn parse_element(chars: &[char], pos: &mut usize, elem_oid: u32) -> Option<Value> {
    let mut text = String::new();
    let mut escaped = false;
    let quoted = chars.get(*pos) == Some(&'"');
    if quoted {
        *pos += 1;
        loop {
            let c = chars.get(*pos).copied()?;
            *pos += 1;
            match c {
                '\\' => {
                    text.push(chars.get(*pos).copied()?);
                    *pos += 1;
                }
                '"' => break,
                _ => text.push(c),
            }
        }
        return Some(cell_to_json(&text, elem_oid));
    }
    while let Some(&c) = chars.get(*pos) {
        if c == ',' || c == '}' {
            break;
        }
        *pos += 1;
        if c == '\\' {
            escaped = true;
            text.push(chars.get(*pos).copied()?);
            *pos += 1;
        } else {
            text.push(c);
        }
    }
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !escaped && trimmed.eq_ignore_ascii_case("NULL") {
        return Some(Value::Null);
    }
    Some(cell_to_json(trimmed, elem_oid))
}

/// Builds the JSON array text for a `Value::Array` element list, with the given element OID.
fn array_literal(items: &[Value], elem_oid: u32) -> Result<String, PgError> {
    let mut parts = Vec::with_capacity(items.len());
    for item in items {
        let part = match item {
            Value::Array(inner) => array_literal(inner, elem_oid)?,
            _ => match param_to_text(item, elem_oid)? {
                Some(text) => quote_element(&text),
                None => "NULL".to_string(),
            },
        };
        parts.push(part);
    }
    Ok(format!("{{{}}}", parts.join(",")))
}

/// Wraps an array element in double quotes, escaping backslash and double quote.
fn quote_element(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Tagged `{"$bigint": "..."}` and `{"$bytes": "..."}` params, as their server text.
fn tagged_text(value: &Value) -> Result<Option<String>, PgError> {
    let Value::Object(map) = value else {
        return Ok(None);
    };
    if map.len() != 1 {
        return Ok(None);
    }
    if let Some(Value::String(digits)) = map.get("$bigint") {
        return Ok(Some(digits.clone()));
    }
    if let Some(Value::String(encoded)) = map.get("$bytes") {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| PgError::local("Invalid input for bytea type"))?;
        return Ok(Some(format!("\\x{}", hex_encode(&bytes))));
    }
    Ok(None)
}

/// Lowercase hex of the bytes.
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// JSON and JSONB params: a string is sent as-is, anything else as JSON text.
fn json_text(value: &Value) -> Result<Option<String>, PgError> {
    match value {
        Value::String(s) => Ok(Some(s.clone())),
        other => serde_json::to_string(other).map(Some).map_err(json_err),
    }
}

#[allow(clippy::needless_pass_by_value, reason = "passed to map_err")]
fn json_err(e: serde_json::Error) -> PgError {
    PgError::local(e.to_string())
}

/// Boolean params: `t`/`f` for bool or 1/0, and strings as-is.
fn bool_text(value: &Value) -> Result<Option<String>, PgError> {
    let text = match value {
        Value::Bool(true) => "t",
        Value::Bool(false) => "f",
        Value::Number(n) => match n.as_f64() {
            Some(1.0) => "t",
            Some(0.0) => "f",
            _ => return Err(PgError::local("Invalid input for boolean type")),
        },
        Value::String(s) => return Ok(Some(s.clone())),
        _ => return Err(PgError::local("Invalid input for boolean type")),
    };
    Ok(Some(text.to_string()))
}

/// Bytea params: strings as-is (tagged `$bytes` is handled earlier).
fn bytea_text(value: &Value) -> Result<Option<String>, PgError> {
    match value {
        Value::String(s) => Ok(Some(s.clone())),
        _ => Err(PgError::local("Invalid input for bytea type")),
    }
}

/// Timestamp and date params: strings as-is, epoch milliseconds as ISO text.
fn timestamp_text(value: &Value) -> Result<Option<String>, PgError> {
    match value {
        Value::String(s) => Ok(Some(s.clone())),
        Value::Number(n) => {
            let ms = n
                .as_i64()
                .ok_or_else(|| PgError::local("Invalid input for timestamp type"))?;
            iso_from_millis(ms).map(Some)
        }
        other => default_text(other),
    }
}

/// Everything else: strings as-is, numbers and bools as JS would print them, arrays and objects as text.
fn default_text(value: &Value) -> Result<Option<String>, PgError> {
    match value {
        Value::Null => Ok(None),
        Value::String(s) => Ok(Some(s.clone())),
        Value::Bool(b) => Ok(Some(b.to_string())),
        Value::Number(n) => Ok(Some(js_number_text(n))),
        Value::Array(items) => array_literal(items, 0).map(Some),
        Value::Object(_) => serde_json::to_string(value).map(Some).map_err(json_err),
    }
}

/// Like JS `Number#toString` for common cases.
fn js_number_text(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    match n.as_f64() {
        // Rust Display differs from JS only for very small or large exponent forms.
        Some(f) if f.is_finite() && f.fract() == 0.0 && f.abs() < 1e21 => format!("{f:.0}"),
        Some(f) => format!("{f}"),
        None => n.to_string(),
    }
}

fn text_value(text: &str) -> Value {
    Value::String(text.to_string())
}

/// `\x` hex bytea text to `{"$bytes": base64}`; bad hex stays a string.
fn bytea_value(text: &str) -> Value {
    match text.strip_prefix("\\x").and_then(decode_hex) {
        Some(bytes) => serde_json::json!({
            "$bytes": base64::engine::general_purpose::STANDARD.encode(bytes),
        }),
        None => text_value(text),
    }
}

fn decode_hex(hex: &str) -> Option<Vec<u8>> {
    let digits = hex.as_bytes();
    if !digits.len().is_multiple_of(2) {
        return None;
    }
    digits
        .chunks(2)
        .map(|pair| {
            let hi = hex_value(*pair.first()?)?;
            let lo = hex_value(*pair.get(1)?)?;
            Some((hi << 4) | lo)
        })
        .collect()
}

fn hex_value(b: u8) -> Option<u8> {
    u8::try_from(char::from(b).to_digit(16)?).ok()
}

/// Timestamp text to JS `toISOString` form; `infinity` is null, anything unusual stays a string.
fn timestamp_value(text: &str) -> Value {
    if matches!(text, "infinity" | "-infinity") {
        return Value::Null;
    }
    match format_timestamp(text) {
        Some(iso) => Value::String(iso),
        None => text_value(text),
    }
}

/// Formats `YYYY-MM-DD HH:MM:SS[.frac][+00|+00:00]` as `YYYY-MM-DDTHH:MM:SS.mmmZ`.
fn format_timestamp(text: &str) -> Option<String> {
    let (date, rest) = text.split_once(' ')?;
    let (time, offset) = match rest.find(['+', '-']) {
        Some(i) => rest.split_at(i),
        None => (rest, ""),
    };
    if !matches!(offset, "" | "+00" | "+00:00") {
        return None;
    }
    let (hms, frac) = match time.split_once('.') {
        Some((hms, frac)) => (hms, Some(frac)),
        None => (time, None),
    };
    if !iso_date(date) || !iso_time(hms) {
        return None;
    }
    // Truncate to milliseconds (not round), then pad with zeros.
    let millis = match frac {
        None => "000".to_string(),
        Some(f) => {
            if f.is_empty() || !f.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            let mut ms: String = f.chars().take(3).collect();
            while ms.len() < 3 {
                ms.push('0');
            }
            ms
        }
    };
    Some(format!("{date}T{hms}.{millis}Z"))
}

fn iso_date(text: &str) -> bool {
    let parts: Vec<&str> = text.split('-').collect();
    matches!(parts.as_slice(), [y, m, d] if all_digits(y, 4) && all_digits(m, 2) && all_digits(d, 2))
}

fn iso_time(text: &str) -> bool {
    let parts: Vec<&str> = text.split(':').collect();
    matches!(parts.as_slice(), [h, m, s] if all_digits(h, 2) && all_digits(m, 2) && all_digits(s, 2))
}

fn all_digits(text: &str, len: usize) -> bool {
    text.len() == len && text.bytes().all(|b| b.is_ascii_digit())
}

/// Epoch milliseconds to `YYYY-MM-DDTHH:MM:SS.mmmZ`; years outside 0..=9999 are an error.
fn iso_from_millis(ms: i64) -> Result<String, PgError> {
    const DAY_MS: i64 = 86_400_000;
    let days = ms.div_euclid(DAY_MS);
    let in_day = ms.rem_euclid(DAY_MS);
    let (year, month, day) = civil_from_days(days);
    if !(0..=9999).contains(&year) {
        return Err(PgError::local("Timestamp out of range"));
    }
    let hours = in_day / 3_600_000;
    let minutes = (in_day % 3_600_000) / 60_000;
    let seconds = (in_day % 60_000) / 1_000;
    let millis = in_day % 1_000;
    Ok(format!(
        "{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}.{millis:03}Z"
    ))
}

/// Days since 1970-01-01 to (year, month, day), by Howard Hinnant's civil-from-days algorithm.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Converts the column cells of one row to a JSON object, keyed by column name.
#[must_use]
pub fn row_to_json(columns: &[Column], cells: &[Option<String>]) -> serde_json::Map<String, Value> {
    let mut row = serde_json::Map::new();
    for (i, column) in columns.iter().enumerate() {
        let value = match cells.get(i) {
            Some(Some(text)) => cell_to_json(text, column.type_oid),
            _ => Value::Null,
        };
        // A later duplicate column name overwrites an earlier one, as in a JS object.
        let _ = row.insert(column.name.clone(), value);
    }
    row
}

/// Converts every row of a result to a JSON object.
#[must_use]
pub fn rows_to_json(rows: &TextRows) -> Vec<Value> {
    rows.rows
        .iter()
        .map(|cells| Value::Object(row_to_json(&rows.columns, cells)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scalar_numbers() -> Result<(), PgError> {
        assert_eq!(cell_to_json("42", 23), json!(42));
        assert!(cell_to_json("9007199254740993", 20).is_number());
        assert_eq!(cell_to_json("NaN", 701), json!(null));
        assert_eq!(cell_to_json("1.5", 701), json!(1.5));
        assert_eq!(cell_to_json("1.50", 1700), json!("1.50"));
        Ok(())
    }

    #[test]
    fn bools() -> Result<(), PgError> {
        assert_eq!(cell_to_json("t", 16), json!(true));
        assert_eq!(cell_to_json("f", 16), json!(false));
        Ok(())
    }

    #[test]
    fn json_columns() -> Result<(), PgError> {
        assert_eq!(cell_to_json(r#"{"a":[1,2]}"#, 3802), json!({"a": [1, 2]}));
        assert_eq!(cell_to_json("{bad", 114), json!("{bad"));
        Ok(())
    }

    #[test]
    fn bytea_column() -> Result<(), PgError> {
        assert_eq!(
            cell_to_json(r"\x48656c6c6f", 17),
            json!({"$bytes": "SGVsbG8="})
        );
        assert_eq!(cell_to_json(r"\xzz", 17), json!(r"\xzz"));
        Ok(())
    }

    #[test]
    fn timestamp_columns() -> Result<(), PgError> {
        assert_eq!(
            cell_to_json("2024-01-02 03:04:05.123456+00", 1184),
            json!("2024-01-02T03:04:05.123Z")
        );
        assert_eq!(
            cell_to_json("2024-01-02 03:04:05+00", 1184),
            json!("2024-01-02T03:04:05.000Z")
        );
        assert_eq!(
            cell_to_json("2024-01-02 03:04:05.5", 1114),
            json!("2024-01-02T03:04:05.500Z")
        );
        assert_eq!(
            cell_to_json("2024-01-02 03:04:05+02", 1184),
            json!("2024-01-02 03:04:05+02")
        );
        assert_eq!(cell_to_json("infinity", 1184), json!(null));
        Ok(())
    }

    #[test]
    fn array_columns() -> Result<(), PgError> {
        assert_eq!(cell_to_json("{1,2,NULL}", 1007), json!([1, 2, null]));
        assert_eq!(
            cell_to_json(r#"{"a,b","NULL",NULL,c}"#, 1009),
            json!(["a,b", "NULL", null, "c"])
        );
        assert_eq!(cell_to_json("{{1,2},{3,4}}", 1007), json!([[1, 2], [3, 4]]));
        assert_eq!(cell_to_json("[0:1]={5,6}", 1007), json!([5, 6]));
        assert_eq!(cell_to_json(r#"{"a\"b"}"#, 1009), json!(["a\"b"]));
        assert_eq!(cell_to_json("{}", 1007), json!([]));
        assert_eq!(cell_to_json("{1,2", 1007), json!("{1,2"));
        Ok(())
    }

    #[test]
    fn plain_text_types_stay_strings() -> Result<(), PgError> {
        assert_eq!(
            cell_to_json("123e4567-e89b-12d3-a456-426614174000", 2950),
            json!("123e4567-e89b-12d3-a456-426614174000")
        );
        assert_eq!(cell_to_json("1 day", 1186), json!("1 day"));
        Ok(())
    }

    #[test]
    fn param_nulls_and_bools() -> Result<(), PgError> {
        assert_eq!(param_to_text(&json!(null), 0)?, None);
        assert_eq!(param_to_text(&json!(true), 16)?, Some("t".to_string()));
        assert_eq!(param_to_text(&json!(true), 0)?, Some("true".to_string()));
        Ok(())
    }

    #[test]
    fn param_numbers() -> Result<(), PgError> {
        assert_eq!(param_to_text(&json!(1.0), 0)?, Some("1".to_string()));
        assert_eq!(param_to_text(&json!(1.5), 0)?, Some("1.5".to_string()));
        Ok(())
    }

    #[test]
    fn param_json_and_tagged() -> Result<(), PgError> {
        assert_eq!(
            param_to_text(&json!({"a": 1}), 3802)?,
            Some(r#"{"a":1}"#.to_string())
        );
        assert_eq!(
            param_to_text(&json!(r#"{"x":1}"#), 3802)?,
            Some(r#"{"x":1}"#.to_string())
        );
        assert_eq!(
            param_to_text(&json!({"$bigint": "123"}), 0)?,
            Some("123".to_string())
        );
        assert_eq!(
            param_to_text(&json!({"$bytes": "SGVsbG8="}), 17)?,
            Some(r"\x48656c6c6f".to_string())
        );
        Ok(())
    }

    #[test]
    fn param_arrays() -> Result<(), PgError> {
        assert_eq!(
            param_to_text(&json!(["a", "b\"c", null]), 1009)?,
            Some(r#"{"a","b\"c",NULL}"#.to_string())
        );
        assert_eq!(
            param_to_text(&json!([[1, 2], [3]]), 1007)?,
            Some(r#"{{"1","2"},{"3"}}"#.to_string())
        );
        Ok(())
    }

    #[test]
    fn param_timestamps() -> Result<(), PgError> {
        assert_eq!(
            param_to_text(&json!(0), 1184)?,
            Some("1970-01-01T00:00:00.000Z".to_string())
        );
        assert_eq!(
            param_to_text(&json!(1_700_000_000_123_i64), 1184)?,
            Some("2023-11-14T22:13:20.123Z".to_string())
        );
        Ok(())
    }

    #[test]
    fn row_with_null_cell() -> Result<(), PgError> {
        let columns = vec![
            Column {
                name: "id".to_string(),
                type_oid: 23,
            },
            Column {
                name: "note".to_string(),
                type_oid: 25,
            },
        ];
        let cells = vec![Some("7".to_string()), None];
        assert_eq!(
            Value::Object(row_to_json(&columns, &cells)),
            json!({"id": 7, "note": null})
        );
        Ok(())
    }
}
