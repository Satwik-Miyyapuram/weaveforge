//! A prefilled "new issue" address, for a copy of the app that cannot file one,
//! and the issue body it carries.
//!
//! GitHub refuses very long addresses (a little past 8 KB), so the body is cut
//! to fit, from the end: the summary and the error come first and survive, the
//! log tail is what gets trimmed. The cut lands on a char boundary, so it never
//! splits a surrogate pair.

use serde::Deserialize;
use url::form_urlencoded::Serializer;

use super::redact::{utf16_len, utf16_prefix};

/// The longest address this builds, comfortably under GitHub's limit.
pub const MAX_URL_LENGTH: usize = 7_500;

/// The most UTF-16 units of the title, after the `[app] ` prefix.
const TITLE_MAX_UTF16: usize = 200;

const CUT_NOTE: &str = "\n\n…(cut to fit the address; the rest is in the app's error log)";

/// The body of a report, as the form posts it. Optional fields may be absent.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReportMarkdown {
    /// What happened, in the app's words.
    pub detail: String,
    /// The route the error was shown on.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub route: Option<String>,
    /// The app version.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub version: Option<String>,
    /// Recent errors and warnings, already redacted by the caller.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub logs: Option<String>,
    /// What the reader was doing: the steps that reproduce it.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub steps: Option<String>,
    /// Labelled context lines; an empty value is left out.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub context: Option<Vec<(String, String)>>,
    /// False leaves off the "What happened" heading. Absent means true.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub with_heading: Option<bool>,
}

/// JavaScript's `String.prototype.trim`, which Rust's `str::trim` differs from
/// on U+0085 (NEL, not trimmed in JS) and U+FEFF (trimmed in JS).
fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| (c.is_whitespace() && c != '\u{0085}') || c == '\u{FEFF}')
}

fn non_empty(s: Option<&str>) -> Option<&str> {
    s.filter(|s| !s.is_empty())
}

/// The address for `body`, cut to fit [`MAX_URL_LENGTH`] UTF-16 units.
#[must_use]
pub fn new_issue_url(title: &str, body: &str, repo: &str) -> String {
    let title = utf16_prefix(&format!("[app] {}", js_trim(title)), TITLE_MAX_UTF16).to_owned();
    let url = build(repo, &title, body);
    if utf16_len(&url) <= MAX_URL_LENGTH {
        return url;
    }

    // Encoding grows text unevenly (an "é" is six characters in the address), so
    // the longest prefix that fits is found by measuring, not by arithmetic.
    let mut low = 0;
    let mut high = utf16_len(body);
    while low < high {
        let mid = (low + high).div_ceil(2);
        let candidate = format!("{}{CUT_NOTE}", utf16_prefix(body, mid));
        if utf16_len(&build(repo, &title, &candidate)) <= MAX_URL_LENGTH {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    build(
        repo,
        &title,
        &format!("{}{CUT_NOTE}", utf16_prefix(body, low)),
    )
}

/// The address for one title and body, form-encoded as `URLSearchParams` does.
fn build(repo: &str, title: &str, body: &str) -> String {
    let query = Serializer::new(String::new())
        .append_pair("title", title)
        .append_pair("body", body)
        .append_pair("labels", "bug,from-app")
        .finish();
    format!("https://github.com/{repo}/issues/new?{query}")
}

/// The issue body, in the same layout the server route files.
#[must_use]
pub fn report_markdown(input: &ReportMarkdown) -> String {
    let where_line = [
        non_empty(input.route.as_deref()).map(|r| format!("Route: `{r}`")),
        non_empty(input.version.as_deref()).map(|v| format!("Version: `{v}`")),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");

    let heading = input.with_heading.unwrap_or(true);
    let mut sections = vec![if heading {
        format!("### What happened\n\n{}", input.detail)
    } else {
        input.detail.clone()
    }];
    if let Some(steps) = non_empty(input.steps.as_deref().map(js_trim)) {
        sections.push(format!("### Steps to reproduce\n\n{steps}"));
    }

    let context: Vec<String> = input
        .context
        .iter()
        .flatten()
        .filter(|(_, value)| !value.is_empty())
        .map(|(label, value)| format!("- {label}: {value}"))
        .collect();
    if !where_line.is_empty() || !context.is_empty() {
        let lines: Vec<String> = std::iter::once(where_line)
            .chain(context)
            .filter(|line| !line.is_empty())
            .collect();
        sections.push(format!("### Where\n\n{}", lines.join("\n")));
    }
    if let Some(logs) = non_empty(input.logs.as_deref()) {
        sections.push(format!(
            "### Recent errors and warnings\n\n```text\n{logs}\n```"
        ));
    }
    sections.join("\n\n")
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn address_carries_title_body_and_labels() {
        let url = new_issue_url("  Papers failed ", "boom", "o/r");
        assert_eq!(
            url,
            "https://github.com/o/r/issues/new?title=%5Bapp%5D+Papers+failed&body=boom&labels=bug%2Cfrom-app"
        );
    }

    #[test]
    fn long_body_is_cut_from_the_end_and_fits() {
        let body = format!("HEAD {}TAIL", "é".repeat(20_000));
        let url = new_issue_url("t", &body, "o/r");
        assert!(
            utf16_len(&url) <= MAX_URL_LENGTH,
            "length {}",
            utf16_len(&url)
        );
        assert!(url.contains("HEAD"));
        assert!(!url.contains("TAIL"));
        assert!(url.contains("cut+to+fit"));
    }

    #[test]
    fn markdown_sections_appear_only_when_filled() {
        let plain = ReportMarkdown {
            detail: "x".into(),
            ..Default::default()
        };
        assert_eq!(report_markdown(&plain), "### What happened\n\nx");
        let full = ReportMarkdown {
            detail: "x".into(),
            route: Some("/papers".into()),
            version: Some("0.6.0".into()),
            logs: Some("err".into()),
            ..Default::default()
        };
        let md = report_markdown(&full);
        assert!(md.contains("Route: `/papers` · Version: `0.6.0`"));
        assert!(md.contains("```text\nerr\n```"));
    }

    #[test]
    fn empty_context_values_are_left_out() {
        let input = ReportMarkdown {
            detail: "boom".into(),
            route: Some("/experiments/".into()),
            context: Some(vec![
                ("Screen".into(), "Experiments › Metrics".into()),
                ("Platform".into(), String::new()),
            ]),
            ..Default::default()
        };
        let md = report_markdown(&input);
        assert!(md.contains("Route: `/experiments/`\n- Screen: Experiments › Metrics"));
        assert!(!md.contains("Platform"));
    }

    #[test]
    fn heading_can_be_left_off() {
        let input = ReportMarkdown {
            detail: "x".into(),
            with_heading: Some(false),
            ..Default::default()
        };
        assert_eq!(report_markdown(&input), "x");
    }
}
