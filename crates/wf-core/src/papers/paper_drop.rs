//! Paper drops: which files count as PDFs or BibTeX, the title read from a PDF
//! (its metadata or first page), and the toast text for a drop.

use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

use super::js_regex::{compile, space_class};
use crate::search::js_text::utf16_len;

/// Past this many bytes a PDF is more likely a scanned book than a paper (200 MiB).
/// Matches the TS `MAX_PDF_BYTES` it replaces.
pub const MAX_PDF_BYTES: f64 = 200.0 * 1024.0 * 1024.0;

/// `arXiv:` stamp in running text, new style (`2301.12345`) or old (`hep-th/9711200`),
/// with an optional version. ASCII `\b`, case-insensitive, JS `\s` spacing, as TS `ARXIV_STAMP`.
static ARXIV_STAMP_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile(&format!(
        r"(?i)\barxiv:[{}]*(?:[a-z-]+(?:\.[a-z]{{2}})?/[0-9]{{7}}|[0-9]{{4}}\.[0-9]{{4,5}})(?:v[0-9]+)?",
        space_class()
    ))
    .ok()
});

/// Where a dropped paper's title came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum TitledBy {
    /// A bibliographic lookup matched the paper.
    Lookup,
    /// The PDF's own metadata or first page.
    Pdf,
    /// Nothing readable in the PDF, so the file name.
    File,
}

/// One outcome of a PDF drop, reduced to what the toast reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DropEntry {
    /// The file became a paper (false: skipped as not a PDF, or too large).
    pub added: bool,
    /// The paper is new (false: it was already in the library).
    pub created: bool,
    /// The dropped PDF was kept as the paper's PDF.
    pub kept_pdf: bool,
    /// How the title was found; set when `added`.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub titled_by: Option<TitledBy>,
    /// The drop ran offline, so no lookup was tried.
    pub offline: bool,
}

/// The toast for a drop, and whether it opens the paper (only a one-file drop does).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PdfDropSummary {
    /// One line for the toast.
    pub message: String,
    /// True when the drop was a single added file, whose paper should open.
    pub opens_paper: bool,
}

/// Lines of a PDF's opening that are running headers, not titles.
const HEADER_NOISE: [&str; 11] = [
    "arxiv",
    "doi",
    "preprint",
    "under review",
    "journal",
    "proceedings",
    "conference",
    "http:",
    "https:",
    "\u{a9}",
    "copyright",
];

/// What writing tools leave in the Title field when the author set none.
const PLACEHOLDER_EXTENSIONS: [&str; 8] = [
    ".pdf", ".doc", ".docx", ".tex", ".dvi", ".ps", ".rtf", ".odt",
];

/// Whether a file is a PDF, by its MIME type or its `.pdf` name (any case).
#[must_use]
pub fn is_pdf_file(name: &str, mime_type: &str) -> bool {
    mime_type == "application/pdf" || name.to_ascii_lowercase().ends_with(".pdf")
}

/// Whether a file is BibTeX, by its `.bib` or `.bibtex` name (any case).
#[must_use]
pub fn is_bib_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".bib") || lower.ends_with(".bibtex")
}

/// Whether a PDF is over [`MAX_PDF_BYTES`] and so is skipped, as TS `file.size > MAX_PDF_BYTES`.
#[must_use]
pub fn is_pdf_too_large(size_bytes: f64) -> bool {
    size_bytes > MAX_PDF_BYTES
}

/// The `arXiv:` stamp matched in a PDF's first-page text (`arXiv:2301.12345v2`), if any.
/// The caller normalizes it with `normalize_arxiv_id`, as the TS flow did.
#[must_use]
pub fn arxiv_stamp(page_text: &str) -> Option<String> {
    ARXIV_STAMP_RE
        .as_ref()?
        .find(page_text)
        .map(|m| m.as_str().to_owned())
}

/// The first of the PDF's opening lines (at most eight) that reads like a
/// title: 12 to 250 UTF-16 units, three or more words, a Latin letter, and no
/// running-header words.
#[must_use]
pub fn guess_title(text: &str) -> Option<String> {
    text.split('\n').take(8).map(normalize_space).find(|line| {
        (12..=250).contains(&utf16_len(line))
            && line.split(' ').count() >= 3
            && line.chars().any(|c| c.is_ascii_alphabetic())
            && !is_header_noise(line)
    })
}

/// The metadata title, unless it is too short, a single word, or a placeholder
/// a writing tool left (`Microsoft Word...`, `Untitled...`, a file name).
#[must_use]
pub fn metadata_title(raw: Option<&str>) -> Option<String> {
    let title = normalize_space(raw?);
    if title.is_empty()
        || utf16_len(&title) < 6
        || title.split(' ').count() < 2
        || is_placeholder_title(&title)
    {
        return None;
    }
    Some(title)
}

/// One line for a BibTeX import toast: what was added, and what was not.
#[must_use]
pub fn bib_import_message(added: usize, skipped: usize, problems: usize) -> String {
    let mut parts = vec![format!("Added {added} paper{}", plural_suffix(added))];
    if skipped > 0 {
        parts.push(format!("skipped {skipped} already in the library"));
    }
    if problems > 0 {
        parts.push(format!("{problems} could not be read"));
    }
    format!("{}.", parts.join(", "))
}

/// One toast for a whole PDF drop. A single added file gets its own message
/// and opens its paper; several files get a count line joined with `·`.
#[must_use]
pub fn summarize_pdf_drop(entries: &[DropEntry]) -> PdfDropSummary {
    if let [only] = entries
        && only.added
    {
        return single_drop_summary(*only);
    }
    let added = entries.iter().filter(|e| e.added).count();
    let created = entries.iter().filter(|e| e.added && e.created).count();
    let dupes = added - created;
    let by_pdf: Vec<&DropEntry> = entries
        .iter()
        .filter(|e| e.added && e.created && e.titled_by == Some(TitledBy::Pdf))
        .collect();
    let by_name = entries
        .iter()
        .filter(|e| e.added && e.created && e.titled_by == Some(TitledBy::File))
        .count();
    let offline = by_pdf.iter().any(|e| e.offline);
    let skipped = entries.len() - added;

    let mut parts = Vec::new();
    if created > 0 {
        parts.push(if created == 1 {
            "1 paper added".to_owned()
        } else {
            format!("{created} papers added")
        });
    }
    if dupes > 0 {
        parts.push(format!("{dupes} already in library"));
    }
    if !by_pdf.is_empty() {
        let n = by_pdf.len();
        parts.push(if offline {
            format!("{n} not looked up (offline)")
        } else {
            format!("{n} not found online")
        });
    }
    if by_name > 0 {
        parts.push(format!("{by_name} titled from the file name"));
    }
    if skipped > 0 {
        parts.push(format!("{skipped} skipped"));
    }
    let message = if parts.is_empty() {
        "No PDFs to add".to_owned()
    } else {
        parts.join(" \u{b7} ")
    };
    PdfDropSummary {
        message,
        opens_paper: false,
    }
}

fn single_drop_summary(only: DropEntry) -> PdfDropSummary {
    let message = if !only.created {
        if only.kept_pdf {
            "Already in library \u{2014} PDF attached"
        } else {
            "Already in library"
        }
    } else {
        match only.titled_by {
            Some(TitledBy::Lookup) => "Paper added",
            Some(TitledBy::Pdf) if only.offline => {
                "Paper added with the PDF's own title \u{2014} offline, so details were not looked up"
            }
            Some(TitledBy::Pdf) => {
                "Paper added with the PDF's own title \u{2014} no match found online"
            }
            _ => "Paper added, titled from the file name \u{2014} the PDF has no readable title",
        }
    };
    PdfDropSummary {
        message: message.to_owned(),
        opens_paper: true,
    }
}

/// `replace(/\s+/g, " ").trim()`.
fn normalize_space(line: &str) -> String {
    line.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_header_noise(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    HEADER_NOISE.iter().any(|word| lower.contains(word))
}

fn is_placeholder_title(title: &str) -> bool {
    let lower = title.to_ascii_lowercase();
    let tool_or_untitled = ["microsoft word", "microsoft powerpoint"]
        .iter()
        .any(|prefix| {
            lower
                .strip_prefix(prefix)
                .is_some_and(|rest| !starts_word(rest))
        })
        || lower
            .strip_prefix("untitled")
            .is_some_and(|rest| !starts_word(rest));
    tool_or_untitled
        || PLACEHOLDER_EXTENSIONS
            .iter()
            .any(|ext| lower.ends_with(ext))
}

/// Whether the text starts with a regex word character (`\w`, ASCII only).
fn starts_word(rest: &str) -> bool {
    rest.chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn plural_suffix(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

/// Where each dropped file goes: `.bib` files are imported, the rest take the PDF path.
/// Both lists hold indices into the drop, in drop order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperDropSplit {
    /// Indices of the files that take the PDF path.
    #[cfg_attr(feature = "specta", specta(type = Vec<u32>))]
    pub pdf_indices: Vec<usize>,
    /// Indices of the `.bib` and `.bibtex` files.
    #[cfg_attr(feature = "specta", specta(type = Vec<u32>))]
    pub bib_indices: Vec<usize>,
}

/// Splits a drop by file name. Every name lands in exactly one of the two lists.
#[must_use]
pub fn split_paper_drop(names: &[String]) -> PaperDropSplit {
    let mut split = PaperDropSplit {
        pdf_indices: Vec::new(),
        bib_indices: Vec::new(),
    };
    for (index, name) in names.iter().enumerate() {
        if is_bib_file(name) {
            split.bib_indices.push(index);
        } else {
            split.pdf_indices.push(index);
        }
    }
    split
}

#[cfg(test)]
mod tests {
    use super::*;

    fn added(created: bool, titled_by: TitledBy, offline: bool, kept_pdf: bool) -> DropEntry {
        DropEntry {
            added: true,
            created,
            kept_pdf,
            titled_by: Some(titled_by),
            offline,
        }
    }

    fn skipped() -> DropEntry {
        DropEntry {
            added: false,
            created: false,
            kept_pdf: false,
            titled_by: None,
            offline: false,
        }
    }

    #[test]
    fn pdf_by_mime_or_name_only() {
        assert!(!is_pdf_file("notes.txt", "text/plain"));
        assert!(is_pdf_file("paper.pdf", ""), "the extension is enough");
        assert!(
            is_pdf_file("scan", "application/pdf"),
            "the MIME type is enough"
        );
        assert!(is_pdf_file("PAPER.PDF", ""));
    }

    #[test]
    fn bib_by_name_only() {
        assert!(is_bib_file("refs.BIB"));
        assert!(is_bib_file("b.bibtex"));
        assert!(!is_bib_file("a.pdf"));
        assert!(!is_bib_file("bib"));
    }

    #[test]
    fn title_guess_skips_header_noise() {
        assert_eq!(
            guess_title(
                "Preprint. Under review.\nDeep Residual Learning for Image Recognition\nKaiming He"
            ),
            Some("Deep Residual Learning for Image Recognition".to_owned())
        );
        assert_eq!(guess_title("short\n12 34\n"), None);
    }

    #[test]
    fn title_guess_collapses_spaces() {
        assert_eq!(
            guess_title("   A   Survey\tof   Graph Neural Networks  \nbody"),
            Some("A Survey of Graph Neural Networks".to_owned())
        );
    }

    #[test]
    fn title_guess_looks_at_eight_lines_only() {
        let text = "1\n2\n3\n4\n5\n6\n7\n8\nA Long Enough Paper Title Here";
        assert_eq!(guess_title(text), None);
    }

    #[test]
    fn too_large_is_strictly_over_the_cap() {
        assert!(!is_pdf_too_large(MAX_PDF_BYTES));
        assert!(is_pdf_too_large(MAX_PDF_BYTES + 1.0));
        assert!(!is_pdf_too_large(0.0));
    }

    #[test]
    fn arxiv_stamp_new_and_old_style() {
        assert_eq!(
            arxiv_stamp("arXiv:2301.12345v2 [cs.LG] 3 Jan 2023"),
            Some("arXiv:2301.12345v2".to_owned())
        );
        assert_eq!(
            arxiv_stamp("arXiv:hep-th/9711200v1 [hep-th]"),
            Some("arXiv:hep-th/9711200v1".to_owned())
        );
        assert_eq!(
            arxiv_stamp("arXiv:cs.LG/0501001"),
            Some("arXiv:cs.LG/0501001".to_owned())
        );
    }

    #[test]
    fn arxiv_stamp_is_case_insensitive_and_word_bounded() {
        assert_eq!(
            arxiv_stamp("ARXIV:2301.12345"),
            Some("ARXIV:2301.12345".to_owned())
        );
        assert_eq!(
            arxiv_stamp("arXiv:  2301.1234"),
            Some("arXiv:  2301.1234".to_owned())
        );
        assert_eq!(arxiv_stamp("myarxiv:2301.12345"), None);
        assert_eq!(arxiv_stamp("no stamp here 2301.12345"), None);
    }

    #[test]
    fn split_paper_drop_routes_bib_files_and_keeps_drop_order() {
        let names: Vec<String> = ["a.pdf", "refs.BIB", "b.bibtex", "notes.txt"]
            .iter()
            .map(|n| (*n).to_owned())
            .collect();
        let split = split_paper_drop(&names);
        assert_eq!(split.pdf_indices, vec![0, 3]);
        assert_eq!(split.bib_indices, vec![1, 2]);
    }

    #[test]
    fn split_paper_drop_of_nothing_is_empty() {
        let split = split_paper_drop(&[]);
        assert!(split.pdf_indices.is_empty());
        assert!(split.bib_indices.is_empty());
    }

    #[test]
    fn metadata_title_rejects_placeholders_and_file_names() {
        assert_eq!(metadata_title(None), None);
        assert_eq!(
            metadata_title(Some("  Deep Residual Learning for Image Recognition ")),
            Some("Deep Residual Learning for Image Recognition".to_owned())
        );
        assert_eq!(metadata_title(Some("Microsoft Word - draft.docx")), None);
        assert_eq!(metadata_title(Some("Untitled document")), None);
        assert_eq!(
            metadata_title(Some("untitled")),
            None,
            "too short, and no word after"
        );
        assert_eq!(
            metadata_title(Some("Untitledness of Things")),
            Some("Untitledness of Things".to_owned()),
            "\\b keeps longer words"
        );
        assert_eq!(metadata_title(Some("final-version.pdf")), None);
        assert_eq!(metadata_title(Some("Short")), None);
    }

    #[test]
    fn bib_message_counts_and_pluralises() {
        assert_eq!(
            bib_import_message(2, 1, 1),
            "Added 2 papers, skipped 1 already in the library, 1 could not be read."
        );
        assert_eq!(bib_import_message(0, 0, 0), "Added 0 papers.");
        assert_eq!(bib_import_message(1, 0, 0), "Added 1 paper.");
    }

    #[test]
    fn single_drop_messages() {
        let s = summarize_pdf_drop(&[added(false, TitledBy::Lookup, false, true)]);
        assert_eq!(s.message, "Already in library \u{2014} PDF attached");
        assert!(s.opens_paper);
        assert_eq!(
            summarize_pdf_drop(&[added(false, TitledBy::Lookup, false, false)]).message,
            "Already in library"
        );
        assert_eq!(
            summarize_pdf_drop(&[added(true, TitledBy::Lookup, false, true)]).message,
            "Paper added"
        );
        assert_eq!(
            summarize_pdf_drop(&[added(true, TitledBy::Pdf, true, true)]).message,
            "Paper added with the PDF's own title \u{2014} offline, so details were not looked up"
        );
        assert_eq!(
            summarize_pdf_drop(&[added(true, TitledBy::Pdf, false, true)]).message,
            "Paper added with the PDF's own title \u{2014} no match found online"
        );
        assert_eq!(
            summarize_pdf_drop(&[added(true, TitledBy::File, false, true)]).message,
            "Paper added, titled from the file name \u{2014} the PDF has no readable title"
        );
    }

    #[test]
    fn several_drops_give_one_count_line() {
        let entries = [
            added(true, TitledBy::Lookup, false, true),
            added(true, TitledBy::Lookup, false, true),
            added(true, TitledBy::File, false, true),
            added(true, TitledBy::Pdf, false, true),
            added(false, TitledBy::Lookup, false, true),
            skipped(),
        ];
        let s = summarize_pdf_drop(&entries);
        assert_eq!(
            s.message,
            "4 papers added \u{b7} 1 already in library \u{b7} 1 not found online \u{b7} 1 titled from the file name \u{b7} 1 skipped"
        );
        assert!(!s.opens_paper, "no single paper to open");
    }

    #[test]
    fn offline_pdf_titles_count_as_not_looked_up() {
        let s = summarize_pdf_drop(&[
            added(true, TitledBy::Pdf, true, true),
            added(true, TitledBy::Lookup, false, true),
        ]);
        assert_eq!(s.message, "2 papers added \u{b7} 1 not looked up (offline)");
    }

    #[test]
    fn only_a_skipped_file_is_counted_not_opened() {
        let s = summarize_pdf_drop(&[skipped()]);
        assert_eq!(s.message, "1 skipped");
        assert!(!s.opens_paper);
        assert_eq!(summarize_pdf_drop(&[]).message, "No PDFs to add");
    }
}
