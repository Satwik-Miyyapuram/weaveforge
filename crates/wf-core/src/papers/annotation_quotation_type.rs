//! How an annotation will be used in writing (Citavi-style). Port of
//! `packages/core/src/features/papers/domain/annotation-quotation-type.ts`.

/// Citavi-style taxonomy for how an annotation will be used in writing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum QuotationType {
    /// Quoted word for word.
    Direct,
    /// Restated in other words.
    Paraphrase,
    /// Condensed.
    Summary,
}

/// Every `QuotationType`, in the order TS lists them.
pub const QUOTATION_TYPES: &[QuotationType] = &[
    QuotationType::Direct,
    QuotationType::Paraphrase,
    QuotationType::Summary,
];

impl QuotationType {
    /// The wire string TS uses.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Paraphrase => "paraphrase",
            Self::Summary => "summary",
        }
    }

    /// The label shown to people (TS `QUOTATION_TYPE_LABELS`).
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Direct => "Direct",
            Self::Paraphrase => "Paraphrase",
            Self::Summary => "Summary",
        }
    }
}

/// Whether `value` is one of the wire strings in [`QUOTATION_TYPES`].
#[must_use]
pub fn is_quotation_type(value: &str) -> bool {
    QUOTATION_TYPES.iter().any(|kind| kind.name() == value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guard_accepts_only_wire_strings() {
        for kind in QUOTATION_TYPES {
            assert!(is_quotation_type(kind.name()));
        }
        assert!(!is_quotation_type("Direct"));
        assert!(!is_quotation_type(""));
        assert!(!is_quotation_type("quote"));
    }

    #[test]
    fn labels_are_capitalized_names() {
        assert_eq!(QuotationType::Paraphrase.label(), "Paraphrase");
    }
}
