//! What the paste pipeline is allowed to do, per user.
//!
//! Port of `packages/core/src/paste/paste-settings.ts`. Defaults are chosen so that a paste
//! is never *surprising*: everything on by default is a repair with no stylistic opinion.
//! Anything that rewrites how a writer set their text (quotes, dashes) is off by default.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::search::js_text::{is_js_whitespace, utf16_len};

/// What the paste pipeline is allowed to do for one user.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PasteSettings {
    /// The master switch. Off means the automatic rules never run; on-demand cleanups still do.
    pub clean_on_paste: bool,
    /// Strip tracking parameters and scroll-to-text fragments from links.
    pub clean_links: bool,
    /// Extra removal rules, one per line: `fbclid`, `site.example | a, b`, or `!youtube.com`.
    pub link_removals: Vec<String>,
    /// Drop zero-width characters and normalise exotic spaces.
    pub normalize_invisible: bool,
    /// Remove blank lines and stray spaces around the paste.
    pub trim_whitespace: bool,
    /// Turn curly quotes and apostrophes into straight ones.
    pub straighten_quotes: bool,
    /// Turn en and em dashes into hyphens.
    pub straighten_dashes: bool,
    /// Strip terminal escape sequences from every paste.
    pub strip_escape_sequences: bool,
    /// Turn a tab-separated paste into a Markdown table. Tabs only.
    pub tabs_to_table: bool,
    /// Turn a bare DOI or arXiv id into a link to its resolver.
    pub link_identifiers: bool,
    /// Fetch the title behind a pasted link and turn it into `[title](url)` (editor-side).
    pub fetch_link_titles: bool,
    /// Download a picture behind a pasted image URL into the workspace (editor-side).
    pub download_pasted_images: bool,
    /// Run the PDF repair automatically on a paste that looks like it came from one.
    pub clean_pdf_on_paste: bool,
}

impl Default for PasteSettings {
    /// TS `DEFAULT_PASTE_SETTINGS`.
    fn default() -> Self {
        Self {
            clean_on_paste: true,
            clean_links: true,
            link_removals: Vec::new(),
            normalize_invisible: true,
            trim_whitespace: true,
            straighten_quotes: false,
            straighten_dashes: false,
            strip_escape_sequences: true,
            tabs_to_table: true,
            link_identifiers: true,
            fetch_link_titles: true,
            download_pasted_images: true,
            clean_pdf_on_paste: false,
        }
    }
}

/// A stored rule list this long is a mistake, not a preference.
const MAX_LINK_REMOVALS: usize = 200;
const MAX_LINK_REMOVAL_LENGTH: usize = 200;

/// Reads whatever was stored and returns settings the pipeline can trust.
///
/// The stored value is user-writable, so anything unrecognised falls back to its default
/// rather than reaching the rules as free-form input.
#[must_use]
pub fn normalize_paste_settings(raw: &Value) -> PasteSettings {
    let Some(input) = raw.as_object() else {
        return PasteSettings::default();
    };
    let mut out = PasteSettings::default();

    let flag = |key: &str, current: &mut bool| {
        if let Some(value) = input.get(key).and_then(Value::as_bool) {
            *current = value;
        }
    };
    flag("cleanOnPaste", &mut out.clean_on_paste);
    flag("cleanLinks", &mut out.clean_links);
    flag("normalizeInvisible", &mut out.normalize_invisible);
    flag("trimWhitespace", &mut out.trim_whitespace);
    flag("straightenQuotes", &mut out.straighten_quotes);
    flag("straightenDashes", &mut out.straighten_dashes);
    flag("stripEscapeSequences", &mut out.strip_escape_sequences);
    flag("tabsToTable", &mut out.tabs_to_table);
    flag("linkIdentifiers", &mut out.link_identifiers);
    flag("fetchLinkTitles", &mut out.fetch_link_titles);
    flag("downloadPastedImages", &mut out.download_pasted_images);
    flag("cleanPdfOnPaste", &mut out.clean_pdf_on_paste);

    if let Some(lines) = input.get("linkRemovals").and_then(Value::as_array) {
        out.link_removals = lines
            .iter()
            .filter_map(Value::as_str)
            .map(|line| line.trim_matches(is_js_whitespace))
            .map(|line| prefix_within_utf16(line, MAX_LINK_REMOVAL_LENGTH))
            .filter(|line| !line.is_empty())
            .take(MAX_LINK_REMOVALS)
            .map(str::to_string)
            .collect();
    }

    out
}

/// Splits a settings textarea into rule lines.
#[must_use]
pub fn parse_link_removal_text(text: &str) -> Vec<String> {
    text.split('\n')
        .map(|line| line.trim_matches(is_js_whitespace))
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

/// The longest char prefix of `text` whose UTF-16 length is at most `max` (JS `slice(0, max)`).
fn prefix_within_utf16(text: &str, max: usize) -> &str {
    let mut end = 0;
    for (index, ch) in text.char_indices() {
        let next = index + ch.len_utf8();
        let Some(head) = text.get(..next) else {
            break;
        };
        if utf16_len(head) > max {
            break;
        }
        end = next;
    }
    text.get(..end).unwrap_or_default()
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_when_stored_value_is_not_an_object() {
        assert_eq!(
            normalize_paste_settings(&Value::Null),
            PasteSettings::default()
        );
        assert_eq!(
            normalize_paste_settings(&json!("nonsense")),
            PasteSettings::default()
        );
        assert_eq!(
            normalize_paste_settings(&json!([])),
            PasteSettings::default()
        );
    }

    #[test]
    fn default_matches_the_documented_defaults() {
        let d = PasteSettings::default();
        assert!(d.clean_on_paste && d.clean_links && d.normalize_invisible);
        assert!(d.trim_whitespace && d.strip_escape_sequences && d.tabs_to_table);
        assert!(d.link_identifiers && d.fetch_link_titles && d.download_pasted_images);
        assert!(!d.straighten_quotes && !d.straighten_dashes && !d.clean_pdf_on_paste);
        assert!(d.link_removals.is_empty());
    }

    #[test]
    fn stored_settings_are_clamped_rather_than_trusted() {
        let normalized = normalize_paste_settings(&json!({
            "cleanLinks": "yes",
            "straightenQuotes": true,
            "linkRemovals": ["  fbclid  ", "", 42, "x".repeat(500)],
            "unknown": 1
        }));
        // A non-boolean falls back to its default rather than reaching the rules.
        assert!(normalized.clean_links);
        assert!(normalized.straighten_quotes);
        assert_eq!(normalized.link_removals.len(), 2);
        assert_eq!(
            normalized.link_removals.first().map(String::as_str),
            Some("fbclid")
        );
        assert_eq!(normalized.link_removals.get(1).map(String::len), Some(200));
    }

    #[test]
    fn non_boolean_flags_keep_their_defaults() {
        let normalized = normalize_paste_settings(&json!({
            "cleanOnPaste": "no",
            "cleanPdfOnPaste": 1
        }));
        assert!(normalized.clean_on_paste);
        assert!(!normalized.clean_pdf_on_paste);
    }

    #[test]
    fn rule_list_is_capped_at_two_hundred() {
        let rules: Vec<String> = (0..500).map(|i| format!("p{i}")).collect();
        let normalized = normalize_paste_settings(&json!({ "linkRemovals": rules }));
        assert_eq!(normalized.link_removals.len(), 200);
    }

    #[test]
    fn rule_length_cap_counts_utf16_units() {
        // 150 astral emoji are 300 UTF-16 units; the cap keeps 100 of them (200 units).
        let astral = "\u{1F600}".repeat(150);
        let normalized = normalize_paste_settings(&json!({ "linkRemovals": [astral] }));
        let rule = normalized
            .link_removals
            .first()
            .cloned()
            .unwrap_or_default();
        assert_eq!(rule.chars().count(), 100);
        assert_eq!(utf16_len(&rule), 200);

        // BMP non-ASCII: one unit per char, so 200 chars survive.
        let accented = "\u{E9}".repeat(300);
        let normalized = normalize_paste_settings(&json!({ "linkRemovals": [accented] }));
        let rule = normalized
            .link_removals
            .first()
            .cloned()
            .unwrap_or_default();
        assert_eq!(rule.chars().count(), 200);
    }

    #[test]
    fn settings_text_splits_into_rules() {
        assert_eq!(
            parse_link_removal_text("fbclid\n\n  site.example | a  \n"),
            vec!["fbclid", "site.example | a"]
        );
    }

    #[test]
    fn settings_text_handles_empty_and_non_ascii_input() {
        assert!(parse_link_removal_text("").is_empty());
        assert!(parse_link_removal_text("  \n\t\n").is_empty());
        assert_eq!(
            parse_link_removal_text("\u{FEFF}caf\u{E9}.example\u{FEFF}"),
            vec!["caf\u{E9}.example"]
        );
    }
}
