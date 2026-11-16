//! The AI proposal card's preview split: a bold first line becomes the title and a
//! `Why:` line the reason. A port of
//! `apps/web/src/features/ai-assistant/application/proposal-preview.ts` (`splitProposalContent`).

use serde::{Deserialize, Serialize};

use crate::search::js_text::is_js_whitespace;

/// A draft's preview split for a card: bold first line → title, "Why:" → reason.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ProposalPreview {
    /// The bold first line, trimmed; `None` when the draft has none.
    pub title: Option<String>,
    /// The `Why:` line, trimmed; `None` when the draft has none.
    pub why: Option<String>,
    /// What is left after the title and reason, with leading whitespace removed.
    pub body: String,
}

/// Split a draft's content into its title, reason and body.
#[must_use]
pub fn split_proposal_content(content: &str) -> ProposalPreview {
    let mut rest = content.trim_matches(is_js_whitespace);
    let mut title = None;
    let mut why = None;
    if let Some((head, after)) = split_title(rest) {
        title = Some(head.trim_matches(is_js_whitespace).to_owned());
        rest = after;
    }
    if let Some((reason, after)) = split_reason(rest) {
        why = Some(reason.trim_matches(is_js_whitespace).to_owned());
        rest = after;
    }
    ProposalPreview {
        title,
        why,
        body: rest.trim_start_matches(is_js_whitespace).to_owned(),
    }
}

/// `^\*\*([^*\n]+)\*\*\s*(?:\n|$)`: the bold title and the text after its line.
fn split_title(text: &str) -> Option<(&str, &str)> {
    let after_open = text.strip_prefix("**")?;
    let end = after_open.find(['*', '\n'])?;
    if end == 0 {
        return None;
    }
    let title = &after_open[..end];
    let tail = after_open[end..].strip_prefix("**")?;
    let ws_len = tail.len() - tail.trim_start_matches(is_js_whitespace).len();
    if ws_len == tail.len() {
        return Some((title, ""));
    }
    let (ws, after) = tail.split_at(ws_len);
    ws.contains('\n').then_some((title, after))
}

/// `^Why: ([^\n]+)\s*(?:\n|$)`: the reason on its line and the text after it.
fn split_reason(text: &str) -> Option<(&str, &str)> {
    let after = text.strip_prefix("Why: ")?;
    let line_end = after.find('\n').unwrap_or(after.len());
    if line_end == 0 {
        return None;
    }
    let (reason, tail) = after.split_at(line_end);
    Some((reason, tail.trim_start_matches(is_js_whitespace)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preview(title: Option<&str>, why: Option<&str>, body: &str) -> ProposalPreview {
        ProposalPreview {
            title: title.map(str::to_owned),
            why: why.map(str::to_owned),
            body: body.to_owned(),
        }
    }

    #[test]
    fn an_mcp_draft_gives_its_summary_as_the_title_and_its_reason_apart() {
        let split = split_proposal_content(
            "**Edit note: Ideas**\n\nWhy: Tighter.\n\nbody:\n\n# Ideas\n- one",
        );
        assert_eq!(
            split,
            preview(
                Some("Edit note: Ideas"),
                Some("Tighter."),
                "body:\n\n# Ideas\n- one"
            )
        );
    }

    #[test]
    fn plain_content_keeps_everything_in_the_body() {
        assert_eq!(
            split_proposal_content("Just an addition."),
            preview(None, None, "Just an addition.")
        );
    }

    #[test]
    fn bold_text_that_is_not_the_first_line_stays_in_the_body() {
        let split = split_proposal_content("Intro\n\n**Not a title**");
        assert_eq!(split.title, None);
        assert_eq!(split.body, "Intro\n\n**Not a title**");
    }

    #[test]
    fn a_bold_line_alone_is_a_title_with_an_empty_body() {
        assert_eq!(
            split_proposal_content("**Only**"),
            preview(Some("Only"), None, "")
        );
    }

    #[test]
    fn bold_text_followed_by_words_on_the_same_line_is_not_a_title() {
        assert_eq!(
            split_proposal_content("**a** text"),
            preview(None, None, "**a** text")
        );
    }

    #[test]
    fn a_reason_without_a_title_is_still_split_out() {
        assert_eq!(
            split_proposal_content("Why: Shorter.\nBody here"),
            preview(None, Some("Shorter."), "Body here")
        );
    }

    #[test]
    fn an_empty_reason_is_not_a_reason() {
        assert_eq!(
            split_proposal_content("Why:\nBody"),
            preview(None, None, "Why:\nBody")
        );
    }
}
