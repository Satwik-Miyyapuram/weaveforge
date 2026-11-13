//! Annotation quotation type row mapping (TS `annotation-quotation-type-rows.ts`). A row is the
//! `annotation_quotation_types` columns as the database names them; the domain type is camelCase.

use serde::{Deserialize, Serialize};

use super::annotation_quotation_type::{QUOTATION_TYPES, QuotationType, is_quotation_type};

/// An `annotation_quotation_types` row as stored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnnotationQuotationTypeRow {
    /// Primary key.
    pub id: String,
    /// The paper the annotation belongs to.
    pub paper_id: String,
    /// The Zotero annotation key.
    pub annotation_key: String,
    /// The stored quotation type, checked by [`to_domain`].
    pub quotation_type: String,
    /// Creation timestamp.
    pub created_at: String,
    /// Last update timestamp.
    pub updated_at: String,
}

/// An annotation's quotation type as the domain holds it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnnotationQuotationType {
    /// Primary key.
    pub id: String,
    /// The paper the annotation belongs to.
    pub paper_id: String,
    /// The Zotero annotation key.
    pub annotation_key: String,
    /// How the annotation will be used in writing.
    pub quotation_type: QuotationType,
    /// Creation timestamp.
    pub created_at: String,
    /// Last update timestamp.
    pub updated_at: String,
}

/// The domain value for a stored row (`toDomain`).
///
/// # Errors
///
/// `Invalid quotation type in store: <value>` when the stored type is not one of the three.
pub fn to_domain(row: AnnotationQuotationTypeRow) -> Result<AnnotationQuotationType, String> {
    if !is_quotation_type(&row.quotation_type) {
        return Err(format!(
            "Invalid quotation type in store: {}",
            row.quotation_type
        ));
    }
    let quotation_type = QUOTATION_TYPES
        .iter()
        .copied()
        .find(|kind| kind.name() == row.quotation_type)
        .ok_or_else(|| format!("Invalid quotation type in store: {}", row.quotation_type))?;
    Ok(AnnotationQuotationType {
        id: row.id,
        paper_id: row.paper_id,
        annotation_key: row.annotation_key,
        quotation_type,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(quotation_type: &str) -> AnnotationQuotationTypeRow {
        AnnotationQuotationTypeRow {
            id: "q1".into(),
            paper_id: "p1".into(),
            annotation_key: "k1".into(),
            quotation_type: quotation_type.into(),
            created_at: "c".into(),
            updated_at: "u".into(),
        }
    }

    #[test]
    fn known_quotation_type_maps_to_domain() {
        let mapped = to_domain(row("paraphrase")).expect("known type");
        assert_eq!(mapped.quotation_type, QuotationType::Paraphrase);
        assert_eq!(mapped.annotation_key, "k1");
    }

    #[test]
    fn unknown_quotation_type_is_refused_with_the_stored_value() {
        assert_eq!(
            to_domain(row("quote")),
            Err("Invalid quotation type in store: quote".to_owned())
        );
    }
}
