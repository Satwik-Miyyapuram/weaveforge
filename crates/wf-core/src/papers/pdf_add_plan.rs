//! The decisions of adding one dropped PDF (TS `addPaperFromPdf`), taken from the results of
//! its I/O: the lookups, the title read from the PDF, and the library's copy of the paper.
//! The I/O itself stays in TS.

use serde::{Deserialize, Serialize};

use super::paper_drop::TitledBy;

/// What the I/O found for one dropped PDF.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PdfAddFacts {
    /// A lookup (DOI, arXiv id or title) matched a paper.
    pub found: bool,
    /// The add made a new paper (false: the library already had it).
    pub created: bool,
    /// The existing paper already has a PDF. Read only when `created` is false.
    pub has_pdf: bool,
    /// A title was read from the PDF or guessed from its text.
    pub has_title: bool,
}

/// The decisions for one dropped PDF.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PdfAddPlan {
    /// A lookup matched the paper.
    pub matched: bool,
    /// Where the title came from.
    pub titled_by: TitledBy,
    /// The dropped file is kept as the paper's PDF.
    pub kept_pdf: bool,
}

/// The decisions for one dropped PDF (TS `addPaperFromPdf`). A lookup match is titled by the
/// lookup; otherwise by the PDF when it has a title, else by the file name. A duplicate keeps
/// its own PDF and takes the dropped file only when it has none.
#[must_use]
pub fn plan_pdf_add(facts: PdfAddFacts) -> PdfAddPlan {
    let titled_by = if facts.found {
        TitledBy::Lookup
    } else if facts.has_title {
        TitledBy::Pdf
    } else {
        TitledBy::File
    };
    PdfAddPlan {
        matched: facts.found,
        titled_by,
        kept_pdf: facts.created || !facts.has_pdf,
    }
}

/// The identifiers read from one dropped PDF, and whether the drop is online.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PdfLookupFacts {
    /// A DOI printed on the first page, when there is one.
    pub doi: Option<String>,
    /// An arXiv id read from the first page's stamp, when there is one.
    pub arxiv_id: Option<String>,
    /// The title read from the PDF or guessed from its text.
    pub title: Option<String>,
    /// The drop is online; offline, no lookup runs.
    pub online: bool,
}

/// One lookup to try, in order (TS `PaperRef` kinds; `title` is a bibliographic lookup).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PdfLookupStep {
    /// Look up by DOI.
    Doi {
        /// The DOI.
        value: String,
    },
    /// Look up by arXiv id.
    Arxiv {
        /// The arXiv id.
        value: String,
    },
    /// Look up by title (bibliographic).
    Title {
        /// The title.
        value: String,
    },
}

/// The lookups to try for one dropped PDF, in order: DOI, then arXiv id, then title. Each is
/// skipped when absent or empty. Offline there are none (TS `addPaperFromPdf`).
#[must_use]
pub fn pdf_lookup_steps(facts: PdfLookupFacts) -> Vec<PdfLookupStep> {
    if !facts.online {
        return Vec::new();
    }
    let present = |value: Option<String>| value.filter(|v| !v.is_empty());
    let mut steps = Vec::new();
    if let Some(value) = present(facts.doi) {
        steps.push(PdfLookupStep::Doi { value });
    }
    if let Some(value) = present(facts.arxiv_id) {
        steps.push(PdfLookupStep::Arxiv { value });
    }
    if let Some(value) = present(facts.title) {
        steps.push(PdfLookupStep::Title { value });
    }
    steps
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    fn lookup(
        doi: Option<&str>,
        arxiv: Option<&str>,
        title: Option<&str>,
        online: bool,
    ) -> PdfLookupFacts {
        PdfLookupFacts {
            doi: doi.map(str::to_owned),
            arxiv_id: arxiv.map(str::to_owned),
            title: title.map(str::to_owned),
            online,
        }
    }

    // it: "the DOI on the first page finds the paper"
    #[test]
    fn a_doi_is_the_first_lookup() {
        let steps = pdf_lookup_steps(lookup(Some("10.1/x"), None, Some("T"), true));
        assert_eq!(
            steps[0],
            PdfLookupStep::Doi {
                value: "10.1/x".to_owned()
            }
        );
    }

    // it: "no DOI: the arXiv stamp on the first page finds the paper"
    #[test]
    fn no_doi_tries_the_arxiv_stamp_next() {
        let steps = pdf_lookup_steps(lookup(None, Some("2301.12345"), None, true));
        assert_eq!(
            steps,
            vec![PdfLookupStep::Arxiv {
                value: "2301.12345".to_owned()
            }]
        );
    }

    // it: "no DOI and no arXiv id falls back to a title lookup"
    #[test]
    fn no_doi_and_no_arxiv_id_falls_back_to_the_title() {
        let steps = pdf_lookup_steps(lookup(None, None, Some("A Title"), true));
        assert_eq!(
            steps,
            vec![PdfLookupStep::Title {
                value: "A Title".to_owned()
            }]
        );
    }

    // it: "a DOI is tried before the arXiv stamp"
    #[test]
    fn doi_then_arxiv_then_title_in_that_order() {
        let steps = pdf_lookup_steps(lookup(Some("10.1/x"), Some("2301.12345"), Some("T"), true));
        assert_eq!(
            steps,
            vec![
                PdfLookupStep::Doi {
                    value: "10.1/x".to_owned()
                },
                PdfLookupStep::Arxiv {
                    value: "2301.12345".to_owned()
                },
                PdfLookupStep::Title {
                    value: "T".to_owned()
                },
            ]
        );
    }

    // it: "an arXiv id that resolves nowhere still tries the title"
    #[test]
    fn the_title_is_still_tried_after_an_arxiv_id() {
        let steps = pdf_lookup_steps(lookup(None, Some("2301.12345"), Some("T"), true));
        assert_eq!(
            steps.last(),
            Some(&PdfLookupStep::Title {
                value: "T".to_owned()
            })
        );
    }

    // it: "a DOI that resolves nowhere still tries the title"
    #[test]
    fn the_title_is_still_tried_after_a_doi() {
        let steps = pdf_lookup_steps(lookup(Some("10.1/x"), None, Some("T"), true));
        assert_eq!(
            steps.last(),
            Some(&PdfLookupStep::Title {
                value: "T".to_owned()
            })
        );
    }

    // it: "offline still reads the PDF: its own title, and the DOI it prints"
    #[test]
    fn offline_runs_no_lookup() {
        assert!(
            pdf_lookup_steps(lookup(Some("10.1/x"), Some("2301.12345"), Some("T"), false))
                .is_empty()
        );
    }

    #[test]
    fn empty_values_are_skipped() {
        let steps = pdf_lookup_steps(lookup(Some(""), None, Some(""), true));
        assert!(steps.is_empty());
    }

    fn facts(found: bool, created: bool, has_pdf: bool, has_title: bool) -> PdfAddFacts {
        PdfAddFacts {
            found,
            created,
            has_pdf,
            has_title,
        }
    }

    // it: "the DOI on the first page finds the paper"
    #[test]
    fn a_lookup_match_is_titled_by_the_lookup() {
        let plan = plan_pdf_add(facts(true, true, false, true));
        assert!(plan.matched);
        assert_eq!(plan.titled_by, TitledBy::Lookup);
    }

    // it: "no match online takes the title from the PDF itself, not the file name"
    #[test]
    fn no_match_takes_the_pdf_title() {
        let plan = plan_pdf_add(facts(false, true, false, true));
        assert!(!plan.matched);
        assert_eq!(plan.titled_by, TitledBy::Pdf);
    }

    // it: "a PDF with no readable title (a scan) is named after the file, and says so"
    #[test]
    fn no_readable_title_is_named_after_the_file() {
        let plan = plan_pdf_add(facts(false, true, false, false));
        assert!(!plan.matched);
        assert_eq!(plan.titled_by, TitledBy::File);
    }

    // it: "a duplicate that has its own PDF opens the existing paper and leaves the PDF alone"
    #[test]
    fn a_duplicate_with_its_own_pdf_keeps_its_pdf() {
        let plan = plan_pdf_add(facts(true, false, true, true));
        assert!(!plan.kept_pdf);
    }

    // it: "a duplicate with no PDF yet keeps the dropped file"
    #[test]
    fn a_duplicate_without_a_pdf_takes_the_dropped_file() {
        let plan = plan_pdf_add(facts(true, false, false, true));
        assert!(plan.kept_pdf);
    }

    #[test]
    fn a_new_paper_always_keeps_the_dropped_file() {
        let plan = plan_pdf_add(facts(false, true, true, false));
        assert!(plan.kept_pdf);
    }
}
