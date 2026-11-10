//! Port of the prompt text in `apps/web/src/features/search/application/ask-library.ts`. Pure:
//! the search, the model call and the nonce stay in the app.

use crate::ai::untrusted_context::{UNTRUSTED_CONTEXT_RULE, UntrustedItem, fence_untrusted};

/// The system turn's instructions (TS `SYSTEM_PROMPT`).
pub const SYSTEM_PROMPT: &str = concat!(
    "You answer questions about the user's research library.",
    " ",
    "Use only the numbered sources supplied. If they do not answer the question, say so.",
    " ",
    "Cite every claim with its source number in square brackets, like [1] or [2].",
    " ",
    "Be brief."
);

/// The fields of a search hit the prompt reads (TS `SearchHit`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AskSource {
    /// The hit's title, the heading of its source block.
    pub title: String,
    /// The PDF page the hit came from, shown as `(p. N)`.
    pub page: Option<u32>,
    /// The hit's excerpt text; an empty excerpt is treated as none.
    pub excerpt: Option<String>,
}

/// The two turns of an ask request, before the app wraps them as a model request.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AskPrompt {
    /// The system turn: instructions, fence description and untrusted-context rule.
    pub system: String,
    /// The user turn: fenced sources, then the question.
    pub user: String,
}

/// The source's heading line and passage; its number is the fence label.
#[must_use]
pub fn source_text(source: &AskSource) -> String {
    let heading = match source.page {
        Some(page) => format!("{} (p. {page})", source.title),
        None => source.title.clone(),
    };
    match source.excerpt.as_deref() {
        Some(text) if !text.is_empty() => format!("{heading}\n{text}"),
        _ => heading,
    }
}

/// The system and user turns for `question` over `sources`, fenced with `nonce`.
#[must_use]
pub fn ask_prompt(question: &str, sources: &[AskSource], nonce: &str) -> AskPrompt {
    let items: Vec<UntrustedItem> = sources
        .iter()
        .enumerate()
        .map(|(index, source)| UntrustedItem {
            label: (index + 1).to_string(),
            text: source_text(source),
        })
        .collect();
    let system = [
        SYSTEM_PROMPT.to_string(),
        format!(
            "Sources are delimited by <<context-{nonce}>> and <</context-{nonce}>>, each headed by its number."
        ),
        UNTRUSTED_CONTEXT_RULE.to_string(),
    ]
    .join("\n");
    AskPrompt {
        system,
        user: format!("{}\n\nQuestion: {question}", fence_untrusted(&items, nonce)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(title: &str, page: Option<u32>, excerpt: Option<&str>) -> AskSource {
        AskSource {
            title: title.to_string(),
            page,
            excerpt: excerpt.map(str::to_string),
        }
    }

    #[test]
    fn heading_carries_page_and_excerpt() {
        assert_eq!(
            source_text(&source("Attention", Some(3), Some("Self-attention."))),
            "Attention (p. 3)\nSelf-attention."
        );
    }

    #[test]
    fn empty_excerpt_is_title_only() {
        assert_eq!(source_text(&source("Only", None, Some(""))), "Only");
    }

    #[test]
    fn user_turn_numbers_and_fences_sources() {
        let prompt = ask_prompt(
            "What replaces recurrence?",
            &[source("Attention", Some(3), Some("Self-attention."))],
            "n0nce",
        );
        assert!(prompt.system.contains(UNTRUSTED_CONTEXT_RULE));
        assert!(prompt.system.contains("<<context-n0nce>>"));
        assert!(
            prompt
                .user
                .contains("[1]\nAttention (p. 3)\nSelf-attention.")
        );
        assert!(prompt.user.ends_with("Question: What replaces recurrence?"));
    }
}
