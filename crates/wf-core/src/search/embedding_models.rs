//! Port of `planEmbeddingStart` in `apps/web/src/features/search/infrastructure/parts-1.ts`.
//! The profile constants stay in TS (the UI reads them). `KNOWN_MODELS` must list
//! every profile id the TS side keeps; never remove one.

/// Snowflake arctic-embed-m v1.5 (TS `ARCTIC_EMBED_M.id`).
pub const ARCTIC_EMBED_M_ID: &str = "Snowflake/snowflake-arctic-embed-m-v1.5";
/// Previous default, still known so stored vectors can be swapped (TS `MINILM_L6.id`).
pub const MINILM_L6_ID: &str = "Xenova/all-MiniLM-L6-v2";

/// Every encoder this app still knows how to load.
pub const KNOWN_MODELS: &[&str] = &[ARCTIC_EMBED_M_ID, MINILM_L6_ID];

/// What to do with stored vectors when the arm starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum EmbeddingStart {
    /// Same encoder: sync what changed.
    Reuse,
    /// A different encoder the app still knows: serve with it while the target embeds, then swap.
    Swap,
    /// Nothing stored, or vectors from an encoder nobody can load any more.
    Rebuild,
}

/// Plan for `stored` (the encoder id the vectors were built with, if any) against `target`.
#[must_use]
pub fn plan_embedding_start(stored: Option<&str>, target: &str) -> EmbeddingStart {
    match stored {
        None => EmbeddingStart::Rebuild,
        Some(model) if model == target => EmbeddingStart::Reuse,
        Some(model) if KNOWN_MODELS.contains(&model) => EmbeddingStart::Swap,
        Some(_) => EmbeddingStart::Rebuild,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_model_reuses() {
        assert_eq!(
            plan_embedding_start(Some(ARCTIC_EMBED_M_ID), ARCTIC_EMBED_M_ID),
            EmbeddingStart::Reuse
        );
    }

    #[test]
    fn known_other_model_swaps() {
        assert_eq!(
            plan_embedding_start(Some(MINILM_L6_ID), ARCTIC_EMBED_M_ID),
            EmbeddingStart::Swap
        );
    }

    #[test]
    fn nothing_stored_or_retired_model_rebuilds() {
        assert_eq!(
            plan_embedding_start(None, ARCTIC_EMBED_M_ID),
            EmbeddingStart::Rebuild
        );
        assert_eq!(
            plan_embedding_start(Some("someone/retired-model"), ARCTIC_EMBED_M_ID),
            EmbeddingStart::Rebuild
        );
    }
}
