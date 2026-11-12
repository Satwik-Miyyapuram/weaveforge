//! Which of the listed copies "Find a free copy" tries, and how many of each format
//! (`apps/web/src/features/reader/application/parts-1.ts`). The fetching, the sanitising and the
//! saving stay in TS; only the choice of candidates is here.

use serde::Serialize;

/// At most this many PDFs are tried; the rest are rarely different copies.
pub const MAX_PDF_ATTEMPTS: usize = 6;

/// At most this many web pages are tried; the rest are rarely different copies.
pub const MAX_HTML_ATTEMPTS: usize = 4;

/// The indexes, into the listed candidates, of the copies to try in each format, in list order.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PickedAttempts {
    /// Indexes of the PDF candidates to try.
    pub pdf: Vec<usize>,
    /// Indexes of the web-page candidates to try.
    pub html: Vec<usize>,
}

/// The per-format caps, for callers that report or test them.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct AttemptLimits {
    /// Cap on PDF attempts.
    pub pdf: usize,
    /// Cap on web-page attempts.
    pub html: usize,
}

/// The caps on attempts per format.
#[must_use]
pub const fn attempt_limits() -> AttemptLimits {
    AttemptLimits {
        pdf: MAX_PDF_ATTEMPTS,
        html: MAX_HTML_ATTEMPTS,
    }
}

/// The first candidates of each format, up to its cap. `formats` holds one format name per
/// listed candidate, in list order; a format that is neither `pdf` nor `html` is never tried.
#[must_use]
pub fn pick_free_copy_attempts(formats: &[String]) -> PickedAttempts {
    let first_of = |wanted: &str, limit: usize| -> Vec<usize> {
        formats
            .iter()
            .enumerate()
            .filter(|(_, format)| format.as_str() == wanted)
            .map(|(index, _)| index)
            .take(limit)
            .collect()
    };
    PickedAttempts {
        pdf: first_of("pdf", MAX_PDF_ATTEMPTS),
        html: first_of("html", MAX_HTML_ATTEMPTS),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn formats(list: &[&str]) -> Vec<String> {
        list.iter().map(|format| (*format).to_owned()).collect()
    }

    #[test]
    fn attempts_are_capped_per_format() {
        let mut list = vec!["pdf"; 10];
        list.extend(["html"; 10]);
        let picked = pick_free_copy_attempts(&formats(&list));
        assert_eq!(picked.pdf, (0..MAX_PDF_ATTEMPTS).collect::<Vec<_>>());
        assert_eq!(
            picked.html,
            (10..10 + MAX_HTML_ATTEMPTS).collect::<Vec<_>>()
        );
        assert_eq!(MAX_PDF_ATTEMPTS, 6);
        assert_eq!(MAX_HTML_ATTEMPTS, 4);
    }

    #[test]
    fn formats_interleave_and_keep_list_order() {
        let picked = pick_free_copy_attempts(&formats(&["html", "pdf", "pdf", "html"]));
        assert_eq!(picked.pdf, vec![1, 2]);
        assert_eq!(picked.html, vec![0, 3]);
    }

    #[test]
    fn an_unknown_format_is_never_tried() {
        let picked = pick_free_copy_attempts(&formats(&["epub", "pdf"]));
        assert_eq!(picked.pdf, vec![1]);
        assert!(picked.html.is_empty());
    }

    #[test]
    fn limits_report_the_caps() {
        assert_eq!(
            attempt_limits(),
            AttemptLimits {
                pdf: MAX_PDF_ATTEMPTS,
                html: MAX_HTML_ATTEMPTS,
            }
        );
    }
}
