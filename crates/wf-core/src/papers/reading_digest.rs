//! A paper's reader marks as note markdown, and a day's reading log (TS
//! `features/papers/application/reading-digest.ts`).
//!
//! The caller does the work that needs the environment: it repairs each quote,
//! builds each reader link, and turns each timestamp into the person's local
//! `YYYY-MM-DD` day. This module only assembles the text.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::js_collate::locale_compare;

const HEADING: &str = "## Highlights";

/// One reader mark, prepared by the caller. Marks with no text and no comment are
/// left out before they get here.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DigestMark {
    /// The mark's text, trimmed. Empty when the mark is a bare comment.
    pub text: String,
    /// The mark's comment, trimmed. Empty when there is none.
    pub comment: String,
    /// The text as a repaired quote block, or empty when there is no text.
    pub quote: String,
    /// The reader link back to the mark.
    pub href: String,
    /// The 0-based page the mark is on, when it has one.
    #[serde(default)]
    pub page_index: Option<u32>,
    /// Position within the paper, used to order marks on the same page.
    pub sort_index: String,
}

/// A paper for the reading log.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReadingPaper {
    /// Paper id.
    pub id: String,
    /// Paper title, as written in the log.
    pub title: String,
    /// The local `YYYY-MM-DD` day the paper was marked read, when it was.
    pub read_day: Option<String>,
}

/// One annotation the reader made, reduced to the day it was made on.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReadingMark {
    /// The paper the annotation belongs to.
    pub paper_id: String,
    /// The local `YYYY-MM-DD` day the annotation was made on.
    pub day: String,
}

/// The reader marks as note markdown: each a quote, then a link back to its page
/// and the comment. Marks already in `existing` are left out, so running it again
/// only adds what is new. Empty when nothing is new.
#[must_use]
pub fn highlights_digest(marks: &[DigestMark], existing: &str) -> String {
    let mut ordered: Vec<&DigestMark> = marks.iter().collect();
    ordered.sort_by(|a, b| {
        a.page_index
            .unwrap_or(u32::MAX)
            .cmp(&b.page_index.unwrap_or(u32::MAX))
            .then_with(|| locale_compare(&a.sort_index, &b.sort_index))
    });

    let mut seen = existing.to_owned();
    let mut blocks: Vec<String> = Vec::new();
    for mark in ordered {
        let label = match mark.page_index {
            None => "in reader".to_owned(),
            Some(page) => format!("p. {}", page.saturating_add(1)),
        };
        let link = format!("[{label}]({})", mark.href);
        let tail = if mark.comment.is_empty() {
            link
        } else {
            format!("{link} {}", mark.comment)
        };
        // A quote already in the note is that mark; a bare comment is its line.
        let key = if mark.quote.is_empty() {
            &tail
        } else {
            &mark.quote
        };
        if seen.contains(key.as_str()) {
            continue;
        }
        let block = if mark.quote.is_empty() {
            tail
        } else {
            format!("{}\n\n{tail}", mark.quote)
        };
        seen.push('\n');
        seen.push_str(&block);
        blocks.push(block);
    }
    if blocks.is_empty() {
        return String::new();
    }
    let head = if existing.contains(HEADING) {
        String::new()
    } else {
        format!("{HEADING}\n\n")
    };
    format!("{head}{}\n", blocks.join("\n\n"))
}

/// A log body for the day `day` (local `YYYY-MM-DD`): papers marked that day, most
/// marks first, then papers marked read that day. Empty when there was none.
#[must_use]
pub fn draft_reading_log(papers: &[ReadingPaper], marks: &[ReadingMark], day: &str) -> String {
    let mut counts: HashMap<&str, u32> = HashMap::new();
    for mark in marks.iter().filter(|m| m.day == day) {
        *counts.entry(mark.paper_id.as_str()).or_insert(0) += 1;
    }

    let mut marked: Vec<&ReadingPaper> = papers
        .iter()
        .filter(|p| counts.contains_key(p.id.as_str()))
        .collect();
    marked.sort_by(|a, b| {
        counts[b.id.as_str()]
            .cmp(&counts[a.id.as_str()])
            .then_with(|| locale_compare(&a.title, &b.title))
    });
    let mut lines: Vec<String> = marked
        .iter()
        .map(|p| {
            let n = counts[p.id.as_str()];
            format!(
                "- [[{}]]: {n} annotation{}",
                p.title,
                if n == 1 { "" } else { "s" }
            )
        })
        .collect();
    lines.extend(
        papers
            .iter()
            .filter(|p| !counts.contains_key(p.id.as_str()) && p.read_day.as_deref() == Some(day))
            .map(|p| format!("- [[{}]]", p.title)),
    );

    if lines.is_empty() {
        String::new()
    } else {
        format!("Reading:\n{}\n", lines.join("\n"))
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use super::*;

    /// A prepared mark. The quote is already a repaired block, as the caller passes it.
    fn mark(
        text: &str,
        comment: &str,
        quote: &str,
        href: &str,
        page: Option<u32>,
        sort: &str,
    ) -> DigestMark {
        DigestMark {
            text: text.to_owned(),
            comment: comment.to_owned(),
            quote: quote.to_owned(),
            href: href.to_owned(),
            page_index: page,
            sort_index: sort.to_owned(),
        }
    }

    fn read_paper(id: &str, title: &str, read_day: Option<&str>) -> ReadingPaper {
        ReadingPaper {
            id: id.to_owned(),
            title: title.to_owned(),
            read_day: read_day.map(str::to_owned),
        }
    }

    fn annotated(paper_id: &str, day: &str) -> ReadingMark {
        ReadingMark {
            paper_id: paper_id.to_owned(),
            day: day.to_owned(),
        }
    }

    #[test]
    fn highlights_become_quotes_with_a_page_link_and_the_comment_in_page_order() {
        let marks = [
            mark(
                "second point",
                "why it matters",
                "> second point",
                "/reader?paper=p1&page=4",
                Some(4),
                "1",
            ),
            mark(
                "first point",
                "",
                "> first point",
                "/reader?paper=p1&page=0",
                Some(0),
                "0",
            ),
        ];
        assert_eq!(
            highlights_digest(&marks, ""),
            "## Highlights\n\n\
             > first point\n\n[p. 1](/reader?paper=p1&page=0)\n\n\
             > second point\n\n[p. 5](/reader?paper=p1&page=4) why it matters\n"
        );
    }

    #[test]
    fn an_ink_mark_with_only_a_comment_keeps_the_comment() {
        let marks = [mark(
            "",
            "see figure",
            "",
            "/reader?paper=p&page=2",
            Some(2),
            "0",
        )];
        let out = highlights_digest(&marks, "");
        assert_eq!(
            out,
            "## Highlights\n\n[p. 3](/reader?paper=p&page=2) see figure\n"
        );
        assert!(!out.lines().any(|l| l.starts_with('>')));
    }

    #[test]
    fn running_it_twice_adds_nothing_new_and_no_second_heading() {
        let anns = [mark(
            "first point",
            "",
            "> first point",
            "/reader?paper=p&page=0",
            Some(0),
            "0",
        )];
        let once = highlights_digest(&anns, "");
        assert_eq!(highlights_digest(&anns, &format!("My note\n\n{once}")), "");
        let more = [
            anns[0].clone(),
            mark(
                "new one",
                "",
                "> new one",
                "/reader?paper=p&page=1",
                Some(1),
                "1",
            ),
        ];
        assert_eq!(
            highlights_digest(&more, &format!("My note\n\n{once}")),
            "> new one\n\n[p. 2](/reader?paper=p&page=1)\n"
        );
    }

    #[test]
    fn a_mark_with_no_page_links_to_the_paper_in_the_reader() {
        let marks = [mark(
            "somewhere",
            "",
            "> somewhere",
            "/reader?paper=p",
            None,
            "0",
        )];
        assert_eq!(
            highlights_digest(&marks, ""),
            "## Highlights\n\n> somewhere\n\n[in reader](/reader?paper=p)\n"
        );
    }

    #[test]
    fn the_log_draft_lists_todays_papers_by_how_much_was_marked_with_read_ones_too() {
        let papers = [
            read_paper("a", "Alpha", None),
            read_paper("b", "Beta", None),
            read_paper("c", "Gamma", Some("2026-11-08")),
            read_paper("d", "Old", Some("2026-11-01")),
        ];
        let anns = [
            annotated("a", "2026-11-08"),
            annotated("b", "2026-11-08"),
            annotated("b", "2026-11-08"),
            annotated("a", "2026-11-07"),
        ];
        assert_eq!(
            draft_reading_log(&papers, &anns, "2026-11-08"),
            "Reading:\n- [[Beta]]: 2 annotations\n- [[Alpha]]: 1 annotation\n- [[Gamma]]\n"
        );
    }

    #[test]
    fn no_reading_today_drafts_nothing() {
        let papers = [read_paper("a", "A", None)];
        assert_eq!(draft_reading_log(&papers, &[], "2026-11-08"), "");
    }
}
