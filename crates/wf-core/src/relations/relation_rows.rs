//! Merging the two sides of a paper's relations (TS `PostgrestPaperRelationRepository.relationsFor`).
//! A relation that runs from and to the same paper is read on both sides, so it must appear once.

use std::collections::HashMap;

use super::paper_relation::PaperRelationRow;

/// One row per id, in the order each id first appears (TS `Map.set` in insertion order). A later
/// row with an id already seen replaces that row's data but keeps its first position.
#[must_use]
pub fn dedupe_relation_rows_by_id(rows: Vec<PaperRelationRow>) -> Vec<PaperRelationRow> {
    let mut out: Vec<PaperRelationRow> = Vec::with_capacity(rows.len());
    let mut position: HashMap<String, usize> = HashMap::with_capacity(rows.len());
    for row in rows {
        if let Some(&index) = position.get(&row.id) {
            out[index] = row;
        } else {
            let _ = position.insert(row.id.clone(), out.len());
            out.push(row);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::relations::graph_settings::RelationType;
    use crate::relations::paper_relation::RelationSource;

    fn row(id: &str, from: &str, note: Option<&str>) -> PaperRelationRow {
        PaperRelationRow {
            id: id.to_owned(),
            from_paper: from.to_owned(),
            to_paper: "other".to_owned(),
            relation: RelationType::Cites,
            note: note.map(str::to_owned),
            source: RelationSource::Manual,
            created_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn a_relation_on_both_sides_appears_once() {
        let from = vec![row("r1", "p", None), row("r2", "p", None)];
        let to = vec![row("r1", "p", None)];
        let merged = dedupe_relation_rows_by_id([from, to].concat());
        let ids: Vec<&str> = merged.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, ["r1", "r2"]);
    }

    #[test]
    fn first_position_is_kept_and_later_data_wins() {
        let rows = vec![
            row("r1", "p", None),
            row("r2", "p", None),
            row("r1", "p", Some("later")),
        ];
        let merged = dedupe_relation_rows_by_id(rows);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].id, "r1");
        assert_eq!(merged[0].note.as_deref(), Some("later"));
        assert_eq!(merged[1].id, "r2");
    }

    #[test]
    fn empty_input_stays_empty() {
        assert!(dedupe_relation_rows_by_id(Vec::new()).is_empty());
    }
}
