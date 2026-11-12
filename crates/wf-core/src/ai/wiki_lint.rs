//! Port of packages/core/src/features/ai-assistant/domain/parts.ts. Pure.
//!
//! Health checks over the wiki, all findable without a model.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use regex_lite::Regex;

use crate::papers::js_regex::compile;
use crate::reader_analysis::lines::{is_js_space, js_trim};
use crate::vault::page::{extract_wikilinks, normalize_title_key};

/// A page with nothing but frontmatter and headings has no content of its own.
const MIN_CONTENT_CHARS: usize = 40;

/// Above this, two titles are the same idea spelled differently.
pub const NEAR_DUPLICATE_THRESHOLD: f64 = 0.75;

/// One `[[...]]` wikilink, brackets included (JS `\[\[[^\]]*\]\]`).
static WIKILINK_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"\[\[[^\]]*\]\]").ok());
/// A `#tag` made of ASCII word characters and hyphens (JS `#[\w-]+`).
static TAG_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"#[A-Za-z0-9_-]+").ok());

/// A wiki page as the lint reads it (TS `WikiPageRef`; `WikiLintPageRef` in the bindings).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "WikiLintPageRef"))]
#[serde(rename_all = "camelCase")]
pub struct WikiPageRef {
    /// Page id.
    pub id: String,
    /// The page title.
    pub title: String,
    /// The page body as markdown.
    pub body: String,
    /// Other names the page answers to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub aliases: Option<Vec<String>>,
}

/// A lint category (TS `LintKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum LintKind {
    /// Same title, different pages.
    Duplicate,
    /// Titles similar enough to review.
    NearDuplicate,
    /// A link to nothing.
    DeadLink,
    /// A page with no edges.
    Orphan,
    /// A page with no content of its own.
    Empty,
}

/// How serious a finding is (TS `LintSeverity`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum LintSeverity {
    /// Must be fixed.
    Error,
    /// Should be reviewed.
    Warning,
    /// For information only.
    Info,
}

/// One problem the lint found (TS `LintFinding`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LintFinding {
    /// The category of the problem.
    pub kind: LintKind,
    /// How serious the problem is.
    pub severity: LintSeverity,
    /// The page the finding is about.
    pub page_id: String,
    /// The human-readable message.
    pub message: String,
    /// The other page involved, for duplicates.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub related_page_id: Option<String>,
    /// The unresolved target, for dead links.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}

/// Finding totals per kind; every kind is present, zero when absent (TS `Record<LintKind, number>`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LintCounts {
    /// Count of `duplicate` findings.
    pub duplicate: u32,
    /// Count of `near-duplicate` findings.
    #[serde(rename = "near-duplicate")]
    pub near_duplicate: u32,
    /// Count of `dead-link` findings.
    #[serde(rename = "dead-link")]
    pub dead_link: u32,
    /// Count of `orphan` findings.
    pub orphan: u32,
    /// Count of `empty` findings.
    pub empty: u32,
}

/// The result of `lint_wiki` (TS `LintReport`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LintReport {
    /// Every finding, in the order the lint produced them.
    pub findings: Vec<LintFinding>,
    /// Totals per kind.
    pub counts: LintCounts,
}

/// One step of a fix plan (TS `FixStep`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FixStep {
    /// The kind of finding this step fixes.
    pub kind: LintKind,
    /// What the step does, for display.
    pub description: String,
    /// The findings this step covers.
    pub findings: Vec<LintFinding>,
}

impl LintCounts {
    fn add(&mut self, kind: LintKind) {
        let slot = match kind {
            LintKind::Duplicate => &mut self.duplicate,
            LintKind::NearDuplicate => &mut self.near_duplicate,
            LintKind::DeadLink => &mut self.dead_link,
            LintKind::Orphan => &mut self.orphan,
            LintKind::Empty => &mut self.empty,
        };
        *slot = slot.saturating_add(1);
    }
}

fn finding(kind: LintKind, severity: LintSeverity, page_id: &str, message: String) -> LintFinding {
    LintFinding {
        kind,
        severity,
        page_id: page_id.to_owned(),
        message,
        related_page_id: None,
        target: None,
    }
}

/// Lints `pages` for duplicates, near-duplicates, dead links, empty pages and orphans (`lintWiki`).
/// `other_titles` are notes and papers outside the wiki; a link to one is not dead (E39).
#[must_use]
#[allow(
    clippy::cast_precision_loss,
    clippy::too_many_lines,
    reason = "title trigram counts stay far below 2^52; one straight port of lintWiki"
)]
pub fn lint_wiki(pages: &[WikiPageRef], other_titles: &[String]) -> LintReport {
    let mut findings: Vec<LintFinding> = Vec::new();
    let outside: HashSet<String> = other_titles
        .iter()
        .map(|t| normalize_title_key(t))
        .collect();

    let mut by_title: HashMap<String, &WikiPageRef> = HashMap::new();
    for page in pages {
        let _ = by_title.insert(normalize_title_key(&page.title), page);
        for alias in page.aliases.iter().flatten() {
            let _ = by_title.insert(normalize_title_key(alias), page);
        }
    }

    // Exact duplicates first: same title, different pages.
    let mut seen_exact: HashMap<String, &str> = HashMap::new();
    for page in pages {
        let key = concept_key(&page.title);
        let first = seen_exact.get(&key).copied();
        match first {
            Some(first) if !first.is_empty() && first != page.id.as_str() => {
                findings.push(LintFinding {
                    related_page_id: Some(first.to_owned()),
                    ..finding(
                        LintKind::Duplicate,
                        LintSeverity::Error,
                        &page.id,
                        format!("\"{}\" already exists as another page.", page.title),
                    )
                });
            }
            _ => {
                let _ = seen_exact.insert(key, page.id.as_str());
            }
        }
    }

    // Near-duplicates, pairwise, over pages that are not already exact duplicates.
    // One trigram set per title, built once.
    let exact: HashSet<&str> = findings.iter().map(|f| f.page_id.as_str()).collect();
    let items: Vec<(&WikiPageRef, HashSet<[u16; 3]>)> = pages
        .iter()
        .filter(|p| !exact.contains(p.id.as_str()))
        .map(|p| (p, title_trigrams(&p.title)))
        .collect();
    for (i, (a, grams_a)) in items.iter().enumerate() {
        for (b, grams_b) in items.iter().skip(i + 1) {
            // Overlap is at most the smaller set over the larger, so a pair whose
            // sizes alone rule it out is skipped without comparing.
            let (x, y) = (grams_a.len(), grams_b.len());
            if (x.min(y) as f64) < NEAR_DUPLICATE_THRESHOLD * (x.max(y) as f64) {
                continue;
            }
            let similarity = trigram_overlap(grams_a, grams_b);
            if similarity < NEAR_DUPLICATE_THRESHOLD || similarity == 1.0 {
                continue;
            }
            findings.push(LintFinding {
                related_page_id: Some(a.id.clone()),
                ..finding(
                    LintKind::NearDuplicate,
                    LintSeverity::Warning,
                    &b.id,
                    format!(
                        "\"{}\" looks like \"{}\" — merge or add an alias?",
                        b.title, a.title
                    ),
                )
            });
        }
    }

    // Pages with any link, blank targets included; the orphan pass reuses it.
    let mut links_out: HashSet<&str> = HashSet::new();
    let mut linked_to: HashSet<&str> = HashSet::new();
    for page in pages {
        let links = extract_wikilinks(&page.body);
        if !links.is_empty() {
            let _ = links_out.insert(page.id.as_str());
        }
        for link in &links {
            let target = js_trim(&link.target);
            if target.is_empty() {
                continue;
            }
            let key = normalize_title_key(target);
            if let Some(&resolved) = by_title.get(&key) {
                let _ = linked_to.insert(resolved.id.as_str());
                continue;
            }
            if outside.contains(&key) {
                continue;
            }
            findings.push(LintFinding {
                target: Some(target.to_owned()),
                ..finding(
                    LintKind::DeadLink,
                    LintSeverity::Warning,
                    &page.id,
                    format!(
                        "\"{}\" links to [[{}]], which does not exist.",
                        page.title, target
                    ),
                )
            });
        }

        if content_length(&page.body) < MIN_CONTENT_CHARS {
            findings.push(finding(
                LintKind::Empty,
                LintSeverity::Info,
                &page.id,
                format!("\"{}\" has no content of its own yet.", page.title),
            ));
        }
    }

    for page in pages {
        let id = page.id.as_str();
        // A page that links out is participating even if nothing links back.
        if linked_to.contains(id) || links_out.contains(id) {
            continue;
        }
        findings.push(finding(
            LintKind::Orphan,
            LintSeverity::Info,
            id,
            format!(
                "\"{}\" is not linked from anywhere and links nowhere.",
                page.title
            ),
        ));
    }

    let mut counts = LintCounts::default();
    for f in &findings {
        counts.add(f.kind);
    }

    LintReport { findings, counts }
}

/// Orders fix steps so merges run before link repair (`planFixOrder`); steps with no findings are dropped.
#[must_use]
pub fn plan_fix_order(report: &LintReport) -> Vec<FixStep> {
    let by = |kind: LintKind| -> Vec<LintFinding> {
        report
            .findings
            .iter()
            .filter(|f| f.kind == kind)
            .cloned()
            .collect()
    };
    let steps = [
        (LintKind::Duplicate, "Merge exact duplicate pages"),
        (LintKind::NearDuplicate, "Review near-duplicate titles"),
        (LintKind::DeadLink, "Resolve links to missing pages"),
        (LintKind::Empty, "Fill in pages with no content"),
        (LintKind::Orphan, "Connect unlinked pages"),
    ];
    steps
        .into_iter()
        .map(|(kind, description)| FixStep {
            kind,
            description: description.to_owned(),
            findings: by(kind),
        })
        .filter(|step| !step.findings.is_empty())
        .collect()
}

/// `conceptKey`: trimmed, lower-cased, inner whitespace runs collapsed to one space.
fn concept_key(name: &str) -> String {
    js_trim(name)
        .to_lowercase()
        .split(is_js_space)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Trigrams of the concept key, padded with a space each side, over UTF-16 units as in JS.
fn title_trigrams(value: &str) -> HashSet<[u16; 3]> {
    let padded: Vec<u16> = format!(" {} ", concept_key(value)).encode_utf16().collect();
    padded.windows(3).map(|w| [w[0], w[1], w[2]]).collect()
}

/// Shared trigrams over the larger set, 0 when either is empty.
#[allow(
    clippy::cast_precision_loss,
    reason = "trigram counts stay far below 2^52"
)]
fn trigram_overlap(first: &HashSet<[u16; 3]>, second: &HashSet<[u16; 3]>) -> f64 {
    if first.is_empty() || second.is_empty() {
        return 0.0;
    }
    let (small, large) = if first.len() <= second.len() {
        (first, second)
    } else {
        (second, first)
    };
    let shared = small.iter().filter(|gram| large.contains(*gram)).count();
    shared as f64 / large.len() as f64
}

/// The body without a leading `---` … `---` block.
fn without_frontmatter(body: &str) -> &str {
    let Some(rest) = body.strip_prefix("---") else {
        return body;
    };
    match rest.find("---") {
        Some(end) => &rest[end + 3..],
        None => body,
    }
}

/// Applies `f` to each line; JS line terminators (`\n`, `\r`, U+2028, U+2029) end a line.
fn map_js_lines(text: &str, f: impl Fn(&str) -> String) -> String {
    let mut out = String::with_capacity(text.len());
    let mut start = 0;
    for (i, c) in text.char_indices() {
        if matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}') {
            out.push_str(&f(&text[start..i]));
            out.push(c);
            start = i + c.len_utf8();
        }
    }
    out.push_str(&f(&text[start..]));
    out
}

/// A markdown heading: 1 to 6 `#`, then a space or tab.
fn is_heading(line: &str) -> bool {
    let hashes = line.bytes().take_while(|&b| b == b'#').count();
    (1..=6).contains(&hashes) && matches!(line.as_bytes().get(hashes), Some(b' ' | b'\t'))
}

/// Drops a leading `-` or `*` bullet marker and its following space.
fn strip_bullet(line: &str) -> &str {
    let rest = line.trim_start_matches([' ', '\t']);
    let mut chars = rest.chars();
    let is_bullet =
        matches!(chars.next(), Some('-' | '*')) && matches!(chars.next(), Some(' ' | '\t'));
    if is_bullet { chars.as_str() } else { line }
}

fn remove_matches(pattern: &LazyLock<Option<Regex>>, text: &str) -> String {
    match pattern.as_ref() {
        Some(re) => re.replace_all(text, "").into_owned(),
        None => text.to_owned(),
    }
}

/// UTF-16 length of the body with frontmatter, headings, bullets, links, quotes and tags removed.
fn content_length(body: &str) -> usize {
    let text = map_js_lines(without_frontmatter(body), |line| {
        if is_heading(line) {
            String::new()
        } else {
            line.to_owned()
        }
    });
    let text = map_js_lines(&text, |line| strip_bullet(line).to_owned());
    let text = remove_matches(&WIKILINK_RE, &text);
    let text = text.replace("_Not written yet._", "");
    let text = map_js_lines(&text, |line| {
        if line.starts_with('>') {
            String::new()
        } else {
            line.to_owned()
        }
    });
    let text = remove_matches(&TAG_RE, &text);
    js_trim(&text).encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(id: &str, title: &str, body: &str) -> WikiPageRef {
        WikiPageRef {
            id: id.to_owned(),
            title: title.to_owned(),
            body: body.to_owned(),
            aliases: None,
        }
    }

    const LONG: &str = "Some real content that is long enough to count.";

    #[test]
    fn exact_duplicate_titles_are_errors() {
        let report = lint_wiki(&[page("a", "VAE", LONG), page("b", "vae", LONG)], &[]);

        assert_eq!(report.counts.duplicate, 1);
        let finding = report
            .findings
            .iter()
            .find(|f| f.kind == LintKind::Duplicate)
            .expect("a duplicate finding");
        assert_eq!(finding.severity, LintSeverity::Error);
        assert_eq!(finding.related_page_id.as_deref(), Some("a"));
    }

    #[test]
    fn near_duplicate_titles_are_flagged_for_review() {
        let report = lint_wiki(
            &[
                page("a", "Variational Autoencoder", LONG),
                page("b", "Variational Autoencoders", LONG),
            ],
            &[],
        );

        assert_eq!(report.counts.near_duplicate, 1);
        let finding = report
            .findings
            .iter()
            .find(|f| f.kind == LintKind::NearDuplicate)
            .expect("a near-duplicate finding");
        assert_eq!(finding.severity, LintSeverity::Warning);
    }

    #[test]
    fn unrelated_titles_are_not_flagged() {
        let report = lint_wiki(
            &[
                page("a", "Graph Neural Networks", LONG),
                page("b", "Reinforcement Learning", LONG),
            ],
            &[],
        );

        assert_eq!(report.counts.near_duplicate, 0);
    }

    #[test]
    fn links_resolve_through_aliases_and_outside_titles() {
        let source = page(
            "a",
            "Source",
            "Links to [[VAE]] in a sentence long enough to count.",
        );
        let aliased = WikiPageRef {
            aliases: Some(vec!["VAE".to_owned()]),
            ..page("b", "Variational Autoencoder", LONG)
        };
        let report = lint_wiki(&[source, aliased], &[]);
        assert_eq!(report.counts.dead_link, 0);

        let outside = page(
            "a",
            "ResNet",
            "From [[Deep Residual Learning]] and [[Method]], at some length.",
        );
        let report = lint_wiki(
            &[outside],
            &["deep residual learning".to_owned(), "Method".to_owned()],
        );
        assert_eq!(report.counts.dead_link, 0);
    }

    #[test]
    fn duplicates_are_fixed_before_dead_links() {
        let report = lint_wiki(
            &[
                page("a", "VAE", LONG),
                page("b", "vae", LONG),
                page(
                    "c",
                    "Method",
                    "Links to [[Nowhere]] in a sentence with enough words.",
                ),
            ],
            &[],
        );

        let order: Vec<LintKind> = plan_fix_order(&report)
            .iter()
            .map(|step| step.kind)
            .collect();
        let dup = order.iter().position(|k| *k == LintKind::Duplicate);
        let dead = order.iter().position(|k| *k == LintKind::DeadLink);
        assert!(dup.is_some() && dead.is_some() && dup < dead);
    }
}
