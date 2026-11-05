//! Custom paper-field kinds and the rollup config encoded in field `options`
//! (TS `features/papers/domain/paper-field.ts`). Pure, no I/O.

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
