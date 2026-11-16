//! The markdown log entry for one citation alert (TS `logBody` in
//! `packages/core/src/features/relations/application/parts.ts`).
//!
//! The citation count is formatted by the caller (`toLocaleString` is locale-dependent and stays in
//! TS). Rust only picks the singular or plural word from the raw count.

use serde::Deserialize;

use super::citation_alerts::{CitationSignals, intent_label};

/// Most items written into one log entry; the rest are summarised in a final line.
const MAX_LOGGED_ITEMS: usize = 20;

/// One ranked citation candidate as the log shows it.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertItem {
    /// Title of the citing paper.
    pub title: String,
    /// Link to the citing paper, when it has one.
    #[serde(default)]
    pub url: Option<String>,
    /// Author names, first author first.
    #[serde(default)]
    pub authors: Vec<String>,
    /// Publication year as text, when known. Empty or absent is left out.
    #[serde(default)]
    pub year: Option<String>,
    /// The raw citation count, used only for the singular or plural word.
    #[serde(default)]
    pub citation_count: Option<f64>,
    /// The citation count formatted for display (TS `toLocaleString`).
    #[serde(default)]
    pub citation_count_text: Option<String>,
    /// Provider flag for highly influential citations.
    #[serde(default)]
    pub is_influential: Option<bool>,
    /// Intent labels, when the provider has them.
    #[serde(default)]
    pub intents: Option<Vec<String>>,
}

/// The markdown body for an alert on `paper_title`. `ranked` is already best first.
#[must_use]
pub fn alert_log_body(paper_title: &str, ranked: &[AlertItem]) -> String {
    let mut lines = vec![
        format!("## Citation alert: {paper_title}"),
        String::new(),
        format!(
            "{} new paper{} cited this tracked paper:",
            ranked.len(),
            plural(ranked.len() == 1)
        ),
        String::new(),
    ];
    for item in ranked.iter().take(MAX_LOGGED_ITEMS) {
        lines.push(item_line(item));
    }
    if ranked.len() > MAX_LOGGED_ITEMS {
        lines.push(format!("- …and {} more", ranked.len() - MAX_LOGGED_ITEMS));
    }
    lines.join("\n")
}

fn item_line(item: &AlertItem) -> String {
    let signals = CitationSignals {
        year: None,
        is_influential: item.is_influential,
        intents: item.intents.clone(),
    };
    // Emphasis, not a code span: the intent is a word, not an identifier (DA-40).
    let intent = intent_label(&signals).filter(|label| !label.is_empty());
    let author = item.authors.first().filter(|name| !name.is_empty());
    let meta: Vec<String> = [
        intent.map(|label| format!("*{label}*")),
        author.map(|name| {
            if item.authors.len() > 1 {
                format!("{name} et al.")
            } else {
                name.clone()
            }
        }),
        item.year.clone().filter(|year| !year.is_empty()),
        citations_text(item),
    ]
    .into_iter()
    .flatten()
    .collect();
    let title = match item.url.as_deref().filter(|url| !url.is_empty()) {
        Some(url) => format!("[{}]({url})", item.title),
        None => item.title.clone(),
    };
    if meta.is_empty() {
        format!("- {title}")
    } else {
        format!("- {title} — {}", meta.join(", "))
    }
}

fn citations_text(item: &AlertItem) -> Option<String> {
    let count = item.citation_count?;
    let text = item.citation_count_text.as_deref()?;
    Some(format!("{text} citation{}", plural(count == 1.0)))
}

/// The plural `s`, unless `singular`.
fn plural(singular: bool) -> &'static str {
    if singular { "" } else { "s" }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(title: &str) -> AlertItem {
        AlertItem {
            title: title.to_owned(),
            ..AlertItem::default()
        }
    }

    // it: "a single alert names the paper and counts one new paper"
    #[test]
    fn a_single_alert_names_the_paper_and_counts_one() {
        let body = alert_log_body("Tracked", &[item("Citing")]);
        assert_eq!(
            body,
            "## Citation alert: Tracked\n\n1 new paper cited this tracked paper:\n\n- Citing"
        );
    }

    // it: "a link, author, year, intent and count make up the line"
    #[test]
    fn a_full_line_carries_its_metadata_in_order() {
        let citing = AlertItem {
            url: Some("https://example.org/p".to_owned()),
            authors: vec!["Ada".to_owned(), "Bo".to_owned()],
            year: Some("2025".to_owned()),
            citation_count: Some(1234.0),
            citation_count_text: Some("1,234".to_owned()),
            intents: Some(vec!["background".to_owned(), "method".to_owned()]),
            ..item("Citing")
        };
        let body = alert_log_body("Tracked", &[citing]);
        assert!(body.ends_with(
            "- [Citing](https://example.org/p) — *method*, Ada et al., 2025, 1,234 citations"
        ));
    }

    // it: "a count of exactly one is singular, and an influential citation says so"
    #[test]
    fn one_citation_is_singular_and_influential_reads_as_such() {
        let citing = AlertItem {
            citation_count: Some(1.0),
            citation_count_text: Some("1".to_owned()),
            is_influential: Some(true),
            ..item("Citing")
        };
        let body = alert_log_body("T", &[citing]);
        assert!(body.ends_with("- Citing — *influential*, 1 citation"));
    }

    // it: "an empty URL, author or year is left out rather than printed"
    #[test]
    fn blank_optional_fields_are_left_out() {
        let citing = AlertItem {
            url: Some(String::new()),
            authors: vec![String::new(), "Second".to_owned()],
            year: Some(String::new()),
            ..item("Citing")
        };
        let body = alert_log_body("T", &[citing]);
        assert!(body.ends_with("- Citing"));
    }

    // it: "more than twenty alerts list twenty and summarise the rest"
    #[test]
    fn more_than_twenty_items_are_summarised() {
        let items: Vec<AlertItem> = (0..23).map(|n| item(&format!("P{n}"))).collect();
        let body = alert_log_body("T", &items);
        assert!(
            body.starts_with("## Citation alert: T\n\n23 new papers cited this tracked paper:")
        );
        assert_eq!(body.matches("\n- ").count(), 21);
        assert!(body.ends_with("- …and 3 more"));
    }
}
