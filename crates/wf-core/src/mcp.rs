//! MCP relay rules: tool manifest, request id and envelope checks, body size limits, and TTL clamping.

use serde_json::{Value, json};

/// Largest encrypted envelope (`iv` plus `ciphertext`), in UTF-16 units.
pub const MAX_ENVELOPE_CHARS: usize = 64_000;

/// Largest relay request body accepted, in bytes.
pub const MAX_BODY_BYTES: u64 = 68_096;

/// Tools that only read the workspace; their results are untrusted input.
pub const READ_TOOLS: [&str; 3] = [
    "search_workspace",
    "get_source_excerpt",
    "get_workspace_outline",
];

/// Every MCP tool name, in manifest order.
pub const TOOL_NAMES: [&str; 13] = [
    "search_workspace",
    "get_source_excerpt",
    "get_workspace_outline",
    "suggest_append_paper_note",
    "suggest_create_vault_note",
    "suggest_create_log_entry",
    "suggest_paper_update",
    "suggest_paper_field_value",
    "suggest_reading_list_change",
    "suggest_relation",
    "suggest_zotero_import",
    "suggest_milestone_follow_up",
    "suggest_experiment_follow_up",
];

/// Tool descriptors returned to MCP clients, one per entry of `TOOL_NAMES`.
#[must_use]
pub fn tool_manifest() -> Vec<Value> {
    TOOL_NAMES
        .iter()
        .map(|name| {
            let is_read = READ_TOOLS.contains(name);
            json!({
                "name": name,
                "readOnly": is_read,
                "requiresBrowserPairing": true,
                "requiresUserConfirmation": name.starts_with("suggest_"),
                "resultsAreUntrusted": is_read,
            })
        })
        .collect()
}

/// Whether `value` is a canonical 8-4-4-4-12 hex UUID (any case, no version check).
#[must_use]
pub fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, &b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}

/// Whether `value` is an object with string `iv` and `ciphertext` within `MAX_ENVELOPE_CHARS`.
#[must_use]
pub fn valid_envelope(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let (Some(iv), Some(ciphertext)) = (
        object.get("iv").and_then(Value::as_str),
        object.get("ciphertext").and_then(Value::as_str),
    ) else {
        return false;
    };
    iv.encode_utf16().count() + ciphertext.encode_utf16().count() <= MAX_ENVELOPE_CHARS
}

/// Whether a declared `Content-Length` exceeds `MAX_BODY_BYTES`. Unparseable values are not rejected here.
#[must_use]
pub fn exceeds_declared_limit(content_length: Option<&str>) -> bool {
    let Some(raw) = content_length.map(str::trim) else {
        return false;
    };
    if raw.is_empty() {
        return false;
    }
    let Ok(declared) = raw.parse::<f64>() else {
        return false;
    };
    let limit = f64::from(u32::try_from(MAX_BODY_BYTES).unwrap_or(u32::MAX));
    declared.is_finite() && declared > limit
}

/// Relay request TTL in milliseconds, mirroring the browser client's clamping.
#[must_use]
pub fn relay_ttl_ms(value: Option<&Value>) -> i64 {
    const DEFAULT_TTL: f64 = 90_000.0;
    let number = match value {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => string_to_number(s),
        Some(Value::Bool(b)) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        _ => f64::NAN,
    };
    let chosen = if number.is_nan() || number == 0.0 {
        DEFAULT_TTL
    } else {
        number
    };
    let clamped = chosen.clamp(15_000.0, 600_000.0).floor();
    clamped.to_string().parse::<i64>().unwrap_or(90_000)
}

/// Numeric value of a string the way `Number(s)` reads it: blank is 0, unparseable is NaN.
fn string_to_number(s: &str) -> f64 {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return 0.0;
    }
    trimmed.parse::<f64>().unwrap_or(f64::NAN)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn manifest_lists_tools_in_order_with_flags() {
        let manifest = tool_manifest();
        assert_eq!(manifest.len(), 13);
        for (entry, name) in manifest.iter().zip(TOOL_NAMES.iter()) {
            assert_eq!(entry["name"], json!(name));
            assert_eq!(entry["requiresBrowserPairing"], json!(true));
        }
        assert_eq!(manifest[0]["readOnly"], json!(true));
        assert_eq!(manifest[0]["resultsAreUntrusted"], json!(true));
        assert_eq!(manifest[0]["requiresUserConfirmation"], json!(false));
        assert_eq!(manifest[3]["readOnly"], json!(false));
        assert_eq!(manifest[3]["requiresUserConfirmation"], json!(true));
        assert_eq!(manifest[3]["resultsAreUntrusted"], json!(false));
    }

    #[test]
    fn uuid_shape() {
        assert!(is_uuid("123e4567-e89b-12d3-a456-426614174000"));
        assert!(is_uuid("123E4567-E89B-12D3-A456-426614174000"));
        assert!(is_uuid("00000000-0000-0000-0000-000000000000"));
        assert!(!is_uuid("123e4567e89b12d3a456426614174000"));
        assert!(!is_uuid("123e4567-e89b-12d3-a456-42661417400g"));
        assert!(!is_uuid("123e4567-e89b-12d3-a456-4266141740000"));
    }

    #[test]
    fn envelope_shape_and_size() {
        assert!(valid_envelope(&json!({"iv": "a", "ciphertext": "b"})));
        assert!(!valid_envelope(&json!({"iv": "a"})));
        assert!(!valid_envelope(&json!({"iv": 1, "ciphertext": "b"})));
        assert!(!valid_envelope(&json!("iv")));
        let big = "x".repeat(MAX_ENVELOPE_CHARS);
        assert!(!valid_envelope(&json!({"iv": "a", "ciphertext": big})));
        let edge = "x".repeat(MAX_ENVELOPE_CHARS - 1);
        assert!(valid_envelope(&json!({"iv": "a", "ciphertext": edge})));
    }

    #[test]
    fn declared_limit() {
        assert!(!exceeds_declared_limit(None));
        assert!(!exceeds_declared_limit(Some("")));
        assert!(!exceeds_declared_limit(Some("abc")));
        assert!(!exceeds_declared_limit(Some("68096")));
        assert!(exceeds_declared_limit(Some(" 70000 ")));
        assert!(exceeds_declared_limit(Some("1e9")));
    }

    #[test]
    fn ttl_defaults_and_clamps() {
        assert_eq!(relay_ttl_ms(None), 90_000);
        assert_eq!(relay_ttl_ms(Some(&json!(0))), 90_000);
        assert_eq!(relay_ttl_ms(Some(&json!("abc"))), 90_000);
        assert_eq!(relay_ttl_ms(Some(&json!(null))), 90_000);
        assert_eq!(relay_ttl_ms(Some(&json!(1))), 15_000);
        assert_eq!(relay_ttl_ms(Some(&json!(30000))), 30_000);
        assert_eq!(relay_ttl_ms(Some(&json!("30000"))), 30_000);
        assert_eq!(relay_ttl_ms(Some(&json!(1e9))), 600_000);
        assert_eq!(relay_ttl_ms(Some(&json!(20000.7))), 20_000);
        assert_eq!(relay_ttl_ms(Some(&json!(true))), 15_000);
    }
}
