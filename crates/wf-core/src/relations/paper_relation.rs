//! Port of `packages/core/src/features/relations/domain/parts.ts`. Pure: the id and
//! time are supplied by the caller, as the TS `IdGenerator` and `Clock` are injected.

use super::graph_settings::RelationType;

/// How a relation edge was created (TS `source`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum RelationSource {
    /// Entered by hand.
    Manual,
    /// Matched from a citation.
    Auto,
}

/// A typed, directed edge between two papers (TS `PaperRelation`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperRelation {
    /// Relation id.
    pub id: String,
    /// The paper the edge starts from.
    pub from_paper: String,
    /// The paper the edge points to.
    pub to_paper: String,
    /// The kind of relation.
    pub relation: RelationType,
    /// Optional free-text note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub note: Option<String>,
    /// How the edge was created.
    pub source: RelationSource,
    /// Creation time, ISO 8601 UTC.
    pub created_at: String,
}

/// Caller input for a new relation (TS `NewPaperRelationInput`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct NewPaperRelationInput {
    /// The paper the edge starts from. Missing reads as blank, which is rejected.
    #[serde(default, deserialize_with = "crate::serde_util::null_default")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub from_paper: String,
    /// The paper the edge points to. Missing reads as blank, which is rejected.
    #[serde(default, deserialize_with = "crate::serde_util::null_default")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub to_paper: String,
    /// The kind of relation.
    pub relation: RelationType,
    /// Optional free-text note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub note: Option<String>,
    /// How the edge was created; defaults to manual.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub source: Option<RelationSource>,
}

/// Check caller input before any id or time is drawn, as TS throws first.
///
/// # Errors
///
/// The validation message when either paper id is empty or a paper relates to itself.
pub fn validate_new_paper_relation(input: &NewPaperRelationInput) -> Result<(), String> {
    if input.from_paper.is_empty() || input.to_paper.is_empty() {
        return Err("Both fromPaper and toPaper are required.".to_owned());
    }
    if input.from_paper == input.to_paper {
        return Err("A paper cannot relate to itself.".to_owned());
    }
    Ok(())
}

/// Create a relation from caller input, with the id and time supplied.
///
/// The TS "unknown relation" check has no port: `relation` is already a `RelationType`, and
/// the wasm boundary rejects any other string while deserializing.
///
/// # Errors
///
/// The validation message when the input does not validate.
pub fn create_paper_relation(
    input: &NewPaperRelationInput,
    id: &str,
    created_at: &str,
) -> Result<PaperRelation, String> {
    validate_new_paper_relation(input)?;
    Ok(PaperRelation {
        id: id.to_owned(),
        from_paper: input.from_paper.clone(),
        to_paper: input.to_paper.clone(),
        relation: input.relation,
        note: input.note.clone(),
        source: input.source.unwrap_or(RelationSource::Manual),
        created_at: created_at.to_owned(),
    })
}

/// A stored `paper_relations` row (TS `PaperRelationRow`). Columns are snake_case.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperRelationRow {
    /// Relation id.
    pub id: String,
    /// The paper the edge starts from.
    pub from_paper: String,
    /// The paper the edge points to.
    pub to_paper: String,
    /// The kind of relation.
    pub relation: RelationType,
    /// Optional note; stored as null when absent.
    pub note: Option<String>,
    /// How the edge was created.
    pub source: RelationSource,
    /// Creation time, ISO 8601 UTC.
    pub created_at: String,
}

/// Map a stored row to the domain relation (TS `toDomain`). A null note reads as absent.
#[must_use]
pub fn paper_relation_from_row(row: PaperRelationRow) -> PaperRelation {
    PaperRelation {
        id: row.id,
        from_paper: row.from_paper,
        to_paper: row.to_paper,
        relation: row.relation,
        note: row.note,
        source: row.source,
        created_at: row.created_at,
    }
}

/// Map a relation to its stored row (TS `toRow`). An absent note is stored as null.
#[must_use]
pub fn paper_relation_to_row(relation: PaperRelation) -> PaperRelationRow {
    PaperRelationRow {
        id: relation.id,
        from_paper: relation.from_paper,
        to_paper: relation.to_paper,
        relation: relation.relation,
        note: relation.note,
        source: relation.source,
        created_at: relation.created_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(note: Option<&str>) -> PaperRelationRow {
        PaperRelationRow {
            id: "r1".to_owned(),
            from_paper: "a".to_owned(),
            to_paper: "b".to_owned(),
            relation: RelationType::Extends,
            note: note.map(str::to_owned),
            source: RelationSource::Auto,
            created_at: "2026-01-02T03:04:05.000Z".to_owned(),
        }
    }

    #[test]
    fn null_note_reads_as_absent_and_round_trips() {
        let rel = paper_relation_from_row(row(None));
        assert_eq!(rel.note, None);
        assert_eq!(paper_relation_to_row(rel), row(None));
    }

    #[test]
    fn row_uses_snake_case_columns_and_null_note() {
        let json = serde_json::to_string(&paper_relation_to_row(paper_relation_from_row(row(
            Some(""),
        ))))
        .expect("serializes");
        assert!(json.contains(r#""from_paper":"a""#));
        assert!(json.contains(r#""created_at":"2026-01-02T03:04:05.000Z""#));
        assert!(json.contains(r#""note":"""#));
    }

    fn input(from: &str, to: &str) -> NewPaperRelationInput {
        NewPaperRelationInput {
            from_paper: from.to_owned(),
            to_paper: to.to_owned(),
            relation: RelationType::Cites,
            note: None,
            source: None,
        }
    }

    #[test]
    fn create_defaults_to_manual_and_omits_absent_note() {
        let rel = create_paper_relation(&input("a", "b"), "id1", "t").expect("valid input");
        assert_eq!(rel.source, RelationSource::Manual);
        assert_eq!(rel.note, None);
        let json = serde_json::to_string(&rel).expect("serializes");
        assert!(!json.contains("note"));
        assert!(json.starts_with(r#"{"id":"id1","fromPaper":"a","toPaper":"b""#));
    }

    #[test]
    fn create_keeps_note_and_explicit_source() {
        let mut inp = input("a", "b");
        inp.note = Some(String::new());
        inp.source = Some(RelationSource::Auto);
        let rel = create_paper_relation(&inp, "id2", "t").expect("valid input");
        assert_eq!(rel.note.as_deref(), Some(""));
        assert_eq!(rel.source, RelationSource::Auto);
    }

    #[test]
    fn empty_paper_id_is_rejected() {
        assert_eq!(
            validate_new_paper_relation(&input("", "b")),
            Err("Both fromPaper and toPaper are required.".to_owned())
        );
        assert!(validate_new_paper_relation(&input("a", "")).is_err());
    }

    #[test]
    fn whitespace_paper_id_is_not_blank() {
        assert!(validate_new_paper_relation(&input(" ", "b")).is_ok());
    }

    #[test]
    fn self_relation_is_rejected() {
        assert_eq!(
            create_paper_relation(&input("a", "a"), "id3", "t"),
            Err("A paper cannot relate to itself.".to_owned())
        );
    }
}
