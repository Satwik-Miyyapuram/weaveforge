//! Paper field row mapping (TS `paper-field-rows.ts`). Rows are the `paper_fields` and
//! `paper_field_values` columns as the database names them; the domain types are camelCase.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::paper_field::{PaperFieldKind, PaperFieldValueData};

/// The message for a stored value that is not a string, a number or a string list.
pub const INVALID_VALUE_PAYLOAD: &str = "Invalid paper field value payload.";

/// A `paper_fields` row as stored. `kind` is read as a string so an unknown stored kind never
/// fails loading (see [`parse_field_kind`]). `options` is read leniently: anything that is not an
/// array of strings reads as an empty list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperFieldDefRow {
    /// Primary key.
    pub id: String,
    /// The field's name.
    pub name: String,
    /// The stored kind string.
    pub kind: String,
    /// The stored options JSON.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(type = specta_typescript::Unknown))]
    pub options: Value,
    /// Display order.
    pub sort_order: f64,
}

/// A `paper_field_values` row as stored. `value` is checked by [`to_value_domain`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperFieldValueRow {
    /// Primary key.
    pub id: String,
    /// The paper the value belongs to.
    pub paper_id: String,
    /// The field the value is for.
    pub field_id: String,
    /// The stored value JSON.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(type = specta_typescript::Unknown))]
    pub value: Value,
}

/// A paper field definition as the domain holds it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperFieldDef {
    /// Primary key.
    pub id: String,
    /// The field's name.
    pub name: String,
    /// The field's kind.
    pub kind: PaperFieldKind,
    /// Option labels, or encoded rollup tokens for a rollup.
    pub options: Vec<String>,
    /// Display order.
    pub sort_order: f64,
}

/// One paper's value for one field, as the domain holds it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperFieldValue {
    /// Primary key.
    pub id: String,
    /// The paper the value belongs to.
    pub paper_id: String,
    /// The field the value is for.
    pub field_id: String,
    /// The checked value.
    pub value: PaperFieldValueData,
}

/// The string items of a stored array; anything else is an empty list (`asStringArray`).
#[must_use]
pub fn as_string_array(raw: &Value) -> Vec<String> {
    match raw {
        Value::Array(items) => items
            .iter()
            .filter_map(|item| item.as_str().map(str::to_owned))
            .collect(),
        _ => Vec::new(),
    }
}

/// A stored value as a string, a number or a string list (`asValueData`).
///
/// # Errors
///
/// [`INVALID_VALUE_PAYLOAD`] when the value is none of those, including a list with a non-string.
pub fn as_value_data(raw: &Value) -> Result<PaperFieldValueData, String> {
    match raw {
        Value::String(text) => Ok(PaperFieldValueData::Text(text.clone())),
        Value::Number(number) => number
            .as_f64()
            .map(PaperFieldValueData::Number)
            .ok_or_else(|| INVALID_VALUE_PAYLOAD.to_owned()),
        Value::Array(items) => items
            .iter()
            .map(|item| item.as_str().map(str::to_owned))
            .collect::<Option<Vec<String>>>()
            .map(PaperFieldValueData::List)
            .ok_or_else(|| INVALID_VALUE_PAYLOAD.to_owned()),
        _ => Err(INVALID_VALUE_PAYLOAD.to_owned()),
    }
}

/// The kind for a stored wire string, or `None` when it is not a known kind.
#[must_use]
pub fn parse_field_kind(raw: &str) -> Option<PaperFieldKind> {
    serde_json::from_value(Value::String(raw.to_owned())).ok()
}

/// The domain definition for a stored row (`toDef`). An unknown stored kind reads as `Text`
/// instead of failing the load, matching the old TS pass-through as closely as the closed enum allows.
#[must_use]
pub fn to_def_domain(row: PaperFieldDefRow) -> PaperFieldDef {
    PaperFieldDef {
        kind: parse_field_kind(&row.kind).unwrap_or(PaperFieldKind::Text),
        id: row.id,
        name: row.name,
        options: as_string_array(&row.options),
        sort_order: row.sort_order,
    }
}

/// The domain value for a stored row (`toValue`).
///
/// # Errors
///
/// As [`as_value_data`].
pub fn to_value_domain(row: PaperFieldValueRow) -> Result<PaperFieldValue, String> {
    Ok(PaperFieldValue {
        value: as_value_data(&row.value)?,
        id: row.id,
        paper_id: row.paper_id,
        field_id: row.field_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn string_array_keeps_only_strings() {
        assert_eq!(as_string_array(&json!(["a", 1, "b"])), vec!["a", "b"]);
        assert!(as_string_array(&json!("a")).is_empty());
    }

    fn def_row(kind: &str) -> PaperFieldDefRow {
        PaperFieldDefRow {
            id: "f1".into(),
            name: "Score".into(),
            kind: kind.into(),
            options: json!(["a"]),
            sort_order: 1.0,
        }
    }

    #[test]
    fn known_kind_maps_to_enum() {
        let def = to_def_domain(def_row("multi_select"));
        assert_eq!(def.kind, PaperFieldKind::MultiSelect);
        assert_eq!(def.options, vec!["a"]);
    }

    #[test]
    fn unknown_kind_loads_without_error() {
        assert_eq!(parse_field_kind("future_kind"), None);
        let def = to_def_domain(def_row("future_kind"));
        assert_eq!(def.kind, PaperFieldKind::Text);
        assert_eq!(def.id, "f1");
        assert_eq!(def.name, "Score");
    }

    #[test]
    fn unknown_kind_row_deserializes() {
        let row: PaperFieldDefRow = serde_json::from_value(json!({
            "id": "f1",
            "name": "Score",
            "kind": "future_kind",
            "options": [],
            "sort_order": 0.0
        }))
        .expect("an unknown kind must not fail deserialization");
        assert_eq!(row.kind, "future_kind");
    }

    #[test]
    fn value_payload_is_string_number_or_string_list() {
        assert_eq!(
            as_value_data(&json!("x")),
            Ok(PaperFieldValueData::Text("x".into()))
        );
        assert_eq!(
            as_value_data(&json!(2.5)),
            Ok(PaperFieldValueData::Number(2.5))
        );
        assert_eq!(
            as_value_data(&json!(["a", "b"])),
            Ok(PaperFieldValueData::List(vec!["a".into(), "b".into()]))
        );
        assert_eq!(
            as_value_data(&json!(["a", 1])),
            Err(INVALID_VALUE_PAYLOAD.to_owned())
        );
        assert_eq!(
            as_value_data(&json!(null)),
            Err(INVALID_VALUE_PAYLOAD.to_owned())
        );
    }
}
