//! Port of the arm and result types, the minimum seed degree and the arm reason text in packages/core/src/search/related.ts. Pure.
//! `findRelated` is not ported: it needs `relatedByPpr` and `WikiGraph`, which have no Rust twin yet.

/// Below this the seed has too little neighbourhood for a walk to say anything (TS `MIN_SEED_DEGREE_FOR_PPR`).
pub const MIN_SEED_DEGREE_FOR_PPR: usize = 3;

/// The method that found a related document (TS `RelatedArm`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum RelatedArm {
    /// Links between notes and papers.
    Graph,
    /// Similar wording.
    Lexical,
    /// Similar meaning.
    Semantic,
    /// Shared tags.
    Tags,
    /// Nothing related found.
    None,
}

/// One related document (TS `RelatedResult`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RelatedResult {
    /// Document id.
    pub id: String,
    /// Rank-blend score; not a number with meaning on its own.
    pub score: f64,
    /// The method that ranked it first.
    pub arm: RelatedArm,
    /// Every method that found it, strongest first, when more than one ran.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub arms: Option<Vec<RelatedArm>>,
    /// Cosine similarity to the seed, 0–1, when the meaning arm found it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub similarity: Option<f64>,
}

/// Human-readable reason for an arm, so a thin result set is explained (TS `explainArm`).
#[must_use]
pub fn explain_arm(arm: RelatedArm) -> &'static str {
    match arm {
        RelatedArm::Graph => "From links between your notes and papers",
        RelatedArm::Lexical => "By similar wording — not enough links yet for the graph",
        RelatedArm::Semantic => "By similar meaning — not enough links yet for the graph",
        RelatedArm::Tags => "By shared tags",
        RelatedArm::None => "Nothing related found yet",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explain_arm_gives_the_reason_text() {
        assert_eq!(
            explain_arm(RelatedArm::Graph),
            "From links between your notes and papers"
        );
        assert_eq!(
            explain_arm(RelatedArm::Lexical),
            "By similar wording — not enough links yet for the graph"
        );
        assert_eq!(
            explain_arm(RelatedArm::Semantic),
            "By similar meaning — not enough links yet for the graph"
        );
        assert_eq!(explain_arm(RelatedArm::Tags), "By shared tags");
        assert_eq!(explain_arm(RelatedArm::None), "Nothing related found yet");
    }

    #[test]
    fn arms_serialize_as_lowercase_names() {
        assert_eq!(
            serde_json::to_string(&RelatedArm::Semantic).unwrap(),
            "\"semantic\""
        );
        assert_eq!(
            serde_json::to_string(&RelatedArm::None).unwrap(),
            "\"none\""
        );
        let arm: RelatedArm = serde_json::from_str("\"tags\"").unwrap();
        assert_eq!(arm, RelatedArm::Tags);
    }

    #[test]
    fn result_omits_absent_optionals_and_keeps_key_order() {
        let bare = RelatedResult {
            id: "a".to_owned(),
            score: 0.5,
            arm: RelatedArm::Lexical,
            arms: None,
            similarity: None,
        };
        assert_eq!(
            serde_json::to_string(&bare).unwrap(),
            r#"{"id":"a","score":0.5,"arm":"lexical"}"#
        );
        let full = RelatedResult {
            id: "b".to_owned(),
            score: 0.25,
            arm: RelatedArm::Graph,
            arms: Some(vec![RelatedArm::Graph, RelatedArm::Semantic]),
            similarity: Some(0.5),
        };
        assert_eq!(
            serde_json::to_string(&full).unwrap(),
            r#"{"id":"b","score":0.25,"arm":"graph","arms":["graph","semantic"],"similarity":0.5}"#
        );
    }

    #[test]
    fn result_reads_missing_optionals_as_none() {
        let hit: RelatedResult =
            serde_json::from_str(r#"{"id":"c","score":1.5,"arm":"tags"}"#).unwrap();
        assert_eq!(hit.arms, None);
        assert_eq!(hit.similarity, None);
        assert_eq!(hit.arm, RelatedArm::Tags);
    }
}
