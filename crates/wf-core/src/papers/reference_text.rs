//! A paper as an APA reference ready to paste (TS apps/web papers/domain/reference-text.ts).

use crate::search::js_text::is_js_whitespace;

/// APA lists up to 20 authors; past that, the first 19, an ellipsis, the last.
const MAX_AUTHORS: usize = 20;

/// The paper fields a reference uses (a subset of TS `Paper`).
#[derive(Debug, Clone, Default, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReferencePaper {
    /// Title.
    pub title: String,
    /// Author names, `Given Family` or `Family, Given`.
    pub authors: Vec<String>,
    /// Publication year.
    pub year: Option<f64>,
    /// Journal or conference.
    pub venue: Option<String>,
    /// DOI, bare or as a doi.org link.
    pub doi: Option<String>,
    /// arXiv id, optionally `arXiv:`-prefixed.
    pub arxiv_id: Option<String>,
    /// Any other link.
    pub url: Option<String>,
}

fn trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

fn words(s: &str) -> Vec<&str> {
    s.split(is_js_whitespace)
        .filter(|w| !w.is_empty())
        .collect()
}

/// "Ann Marie Lee" or "Lee, Ann Marie" → "Lee, A. M."; one word stays as is.
fn apa_name(raw: &str) -> String {
    let name = trim(raw);
    let (last, given): (&str, Vec<&str>) = if name.contains(',') {
        // JS `split(",", 2)`: text after a second comma is dropped.
        let mut pieces = name.split(',');
        let family = trim(pieces.next().unwrap_or(""));
        (family, words(trim(pieces.next().unwrap_or(""))))
    } else {
        let mut parts = words(name);
        if parts.len() < 2 {
            return name.to_owned();
        }
        let last = parts.pop().unwrap_or("");
        (last, parts)
    };
    let initials: Vec<String> = given
        .iter()
        .filter_map(|g| g.chars().next())
        .map(|c| format!("{}.", c.to_uppercase()))
        .collect();
    if initials.is_empty() {
        last.to_owned()
    } else {
        format!("{last}, {}", initials.join(" "))
    }
}

fn author_list(authors: &[String]) -> String {
    let names: Vec<String> = authors
        .iter()
        .map(|a| apa_name(a))
        .filter(|n| !n.is_empty())
        .collect();
    match names.as_slice() {
        [] => String::new(),
        [one] => one.clone(),
        [.., last] if names.len() > MAX_AUTHORS => {
            format!("{}, . . . {last}", names[..MAX_AUTHORS - 1].join(", "))
        }
        [init @ .., last] => format!("{}, & {last}", init.join(", ")),
    }
}

/// End a part with a full stop unless it already ends in one (or ? / !).
fn sentence(text: &str) -> String {
    if text.ends_with(['.', '?', '!']) {
        text.to_owned()
    } else {
        format!("{text}.")
    }
}

/// `text` without a case-insensitive ASCII `prefix`.
fn strip_prefix_ci<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &text[prefix.len()..])
}

fn bare_doi(doi: &str) -> &str {
    for scheme in ["https://", "http://"] {
        if let Some(rest) = strip_prefix_ci(doi, scheme) {
            for host in ["dx.doi.org/", "doi.org/"] {
                if let Some(id) = strip_prefix_ci(rest, host) {
                    return id;
                }
            }
        }
    }
    doi
}

fn link(paper: &ReferencePaper) -> String {
    let doi = paper
        .doi
        .as_deref()
        .map(|d| bare_doi(trim(d)))
        .unwrap_or("");
    if !doi.is_empty() {
        return format!("https://doi.org/{doi}");
    }
    let arxiv = paper
        .arxiv_id
        .as_deref()
        .map(|a| strip_prefix_ci(trim(a), "arxiv:").unwrap_or(trim(a)))
        .unwrap_or("");
    if !arxiv.is_empty() {
        return format!("https://arxiv.org/abs/{arxiv}");
    }
    paper.url.as_deref().map(trim).unwrap_or("").to_owned()
}

/// A paper as a reference in APA style: `Lee, A., & Chen, B. (2020). Title. Venue. https://doi.org/…`.
#[must_use]
pub fn format_reference(paper: &ReferencePaper) -> String {
    let authors = author_list(&paper.authors);
    let year = match paper.year {
        Some(y) => format!("({y})."),
        None => "(n.d.).".to_owned(),
    };
    let title = sentence(trim(&paper.title));
    let mut parts = if authors.is_empty() {
        vec![title, year]
    } else {
        vec![sentence(&authors), year, title]
    };
    if let Some(venue) = paper.venue.as_deref().map(trim).filter(|v| !v.is_empty()) {
        parts.push(sentence(venue));
    }
    let url = link(paper);
    if !url.is_empty() {
        parts.push(url);
    }
    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paper() -> ReferencePaper {
        ReferencePaper {
            title: "Attention is all you need".into(),
            authors: vec!["Ashish Vaswani".into(), "Noam Shazeer".into()],
            year: Some(2017.0),
            venue: Some("NeurIPS".into()),
            doi: Some("10.1/abc".into()),
            ..ReferencePaper::default()
        }
    }

    #[test]
    fn formats_full_reference() {
        assert_eq!(
            format_reference(&paper()),
            "Vaswani, A., & Shazeer, N. (2017). Attention is all you need. NeurIPS. https://doi.org/10.1/abc"
        );
    }

    #[test]
    fn names_in_both_orders_and_single_words() {
        assert_eq!(apa_name("Lee, Ann Marie"), "Lee, A. M.");
        assert_eq!(apa_name("Ann Marie Lee"), "Lee, A. M.");
        assert_eq!(apa_name("OpenAI"), "OpenAI");
        assert_eq!(apa_name("Lee, ann, Jr"), "Lee, A.");
    }

    #[test]
    fn no_authors_no_year() {
        let p = ReferencePaper {
            title: "T".into(),
            ..ReferencePaper::default()
        };
        assert_eq!(format_reference(&p), "T. (n.d.).");
    }

    #[test]
    fn long_author_lists_elide() {
        let mut p = paper();
        p.authors = (1..=25).map(|i| format!("A{i} Z{i}")).collect();
        let r = format_reference(&p);
        assert!(r.contains("Z19, A., . . . Z25, A."), "{r}");
    }

    #[test]
    fn links_prefer_doi_then_arxiv_then_url() {
        let mut p = paper();
        p.doi = Some("HTTPS://dx.doi.org/10.1/x".into());
        assert!(format_reference(&p).ends_with(" https://doi.org/10.1/x"));
        p.doi = Some("  ".into());
        p.arxiv_id = Some("arXiv:1706.03762".into());
        assert!(format_reference(&p).ends_with(" https://arxiv.org/abs/1706.03762"));
        p.arxiv_id = None;
        p.url = Some(" https://x.org/a ".into());
        assert!(format_reference(&p).ends_with(" https://x.org/a"));
    }

    #[test]
    fn title_keeps_its_question_mark() {
        let p = ReferencePaper {
            title: "Is it?".into(),
            year: Some(2017.0),
            ..ReferencePaper::default()
        };
        assert_eq!(format_reference(&p), "Is it? (2017).");
    }
}
