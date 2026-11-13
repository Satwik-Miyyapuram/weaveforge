//! Extraction-table row assembly (TS `features/reading-lists/application/extraction-rows.ts`):
//! which listed papers still exist, in list order, each with its values. The TS adapter passes
//! the paper ids it has and maps each returned index back to its paper object.

use std::collections::{BTreeMap, HashMap};

use serde::Serialize;

use super::extraction_table::{ExtractionFieldDef, paper_value_rows};
use crate::papers::compute_rollup::RollupValue;
use crate::papers::paper_field::PaperFieldValueData;

/// One listed paper that exists: where it sits in the caller's paper list, and its values.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FlatPaperRow {
    /// Index of the paper in the caller's `known_ids` list. A repeated id resolves to its last
    /// position, as a JS `Map` built from the list does.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub paper_index: usize,
    /// Stored and rollup values, keyed by field id.
    pub values: BTreeMap<String, PaperFieldValueData>,
}

/// The rows for the listed papers that exist, in list order. An id that is not in `known_ids` is
/// dropped before the rollups run; a paper listed twice appears once, at its first place.
#[must_use]
pub fn flatten_paper_rows(
    known_ids: &[String],
    paper_ids: &[String],
    values: &[RollupValue],
    defs: &[ExtractionFieldDef],
) -> Vec<FlatPaperRow> {
    let mut index_by_id: HashMap<&str, usize> = HashMap::new();
    for (index, id) in known_ids.iter().enumerate() {
        let _ = index_by_id.insert(id.as_str(), index);
    }

    let present: Vec<String> = paper_ids
        .iter()
        .filter(|id| index_by_id.contains_key(id.as_str()))
        .cloned()
        .collect();

    paper_value_rows(&present, values, defs)
        .into_iter()
        .filter_map(|row| {
            let paper_index = *index_by_id.get(row.paper_id.as_str())?;
            Some(FlatPaperRow {
                paper_index,
                values: row.values,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|id| (*id).to_owned()).collect()
    }

    fn indices(rows: &[FlatPaperRow]) -> Vec<usize> {
        rows.iter().map(|row| row.paper_index).collect()
    }

    #[test]
    fn drops_unknown_ids_and_keeps_list_order() {
        let rows = flatten_paper_rows(&ids(&["a", "b", "c"]), &ids(&["c", "x", "a"]), &[], &[]);
        assert_eq!(indices(&rows), vec![2, 0]);
    }

    #[test]
    fn a_paper_listed_twice_appears_once_at_its_first_place() {
        let rows = flatten_paper_rows(&ids(&["a", "b"]), &ids(&["b", "a", "b"]), &[], &[]);
        assert_eq!(indices(&rows), vec![1, 0]);
    }

    #[test]
    fn a_repeated_known_id_resolves_to_its_last_position() {
        // JS: new Map([["a", pa], ["b", pb], ["a", pa2]]).get("a") is pa2.
        let rows = flatten_paper_rows(&ids(&["a", "b", "a"]), &ids(&["a"]), &[], &[]);
        assert_eq!(indices(&rows), vec![2]);
    }

    #[test]
    fn no_known_papers_or_no_listed_papers_gives_no_rows() {
        assert!(flatten_paper_rows(&ids(&["a"]), &[], &[], &[]).is_empty());
        assert!(flatten_paper_rows(&[], &ids(&["x"]), &[], &[]).is_empty());
    }

    #[test]
    fn a_paper_without_values_gets_an_empty_value_map() {
        let rows = flatten_paper_rows(&ids(&["a"]), &ids(&["a"]), &[], &[]);
        assert_eq!(rows.len(), 1);
        assert!(rows[0].values.is_empty());
    }

    #[test]
    fn a_row_carries_its_stored_values_and_skips_values_of_unlisted_papers() {
        let values: Vec<RollupValue> = serde_json::from_value(serde_json::json!([
            { "paperId": "a", "fieldId": "notes", "value": "kept" },
            { "paperId": "gone", "fieldId": "notes", "value": "dropped" }
        ]))
        .expect("rollup values parse");
        let rows = flatten_paper_rows(&ids(&["a", "b"]), &ids(&["b", "a"]), &values, &[]);
        assert_eq!(indices(&rows), vec![1, 0]);
        assert!(rows[0].values.is_empty());
        assert_eq!(
            rows[1].values.get("notes"),
            Some(&PaperFieldValueData::Text("kept".to_owned()))
        );
        assert_eq!(rows[1].values.len(), 1);
    }
}
