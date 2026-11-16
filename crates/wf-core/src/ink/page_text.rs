//! The page's text once handwriting has been recognised: the typed text, then the
//! recognised text, with the page's background and figures kept as they were.
//!
//! A port of `pageTextAfterRecognition` in `apps/web/src/features/ink/application/parts-4.ts`.

use super::figure::{ink_page_figures, with_ink_page_figures};
use super::ink_page::{ink_page_background, with_ink_page_background};

/// JavaScript's `String.prototype.trim`: Unicode white space plus the byte-order mark.
fn js_trim(text: &str) -> &str {
    text.trim_matches(|ch: char| ch.is_whitespace() || ch == '\u{FEFF}')
}

/// The page text after a recognition pass.
///
/// `was` is the page text before recognition, `prior` the text the last recognition
/// wrote into it, and `recognised` the new recognised text. The typed part is what
/// `was` holds before the prior recognised text, so re-recognising replaces it rather
/// than doubling it.
#[must_use]
pub fn page_text_after_recognition(was: &str, prior: &str, recognised: &str) -> String {
    let joined = with_ink_page_figures(&with_ink_page_background(was, None), &[]);
    let body = js_trim(&joined);
    let old = js_trim(prior);
    let typed = if !old.is_empty() && body == old {
        ""
    } else if !old.is_empty() && body.ends_with(&format!("\n{old}")) {
        js_trim(&body[..body.len() - old.len()])
    } else {
        body
    };
    let text = [typed, js_trim(recognised)]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    with_ink_page_figures(
        &with_ink_page_background(&text, ink_page_background(was)),
        &ink_page_figures(was),
    )
}

// The TS tests on main cover `isHydratedPage`/`noteBodyText`, which are not ported here,
// so these cases come from the doc comment above.
#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use super::*;

    #[test]
    fn empty_page_keeps_only_the_recognised_text() {
        assert_eq!(page_text_after_recognition("", "", "hello"), "hello");
    }

    #[test]
    fn typed_text_stays_above_the_recognised_text() {
        assert_eq!(
            page_text_after_recognition("typed note", "", "ocr"),
            "typed note\n\nocr"
        );
    }

    #[test]
    fn rerecognition_replaces_the_prior_recognised_text() {
        assert_eq!(
            page_text_after_recognition("typed note\nold ocr", "old ocr", "new ocr"),
            "typed note\n\nnew ocr"
        );
    }

    #[test]
    fn page_that_is_only_the_prior_text_is_replaced() {
        assert_eq!(
            page_text_after_recognition("old ocr", "old ocr", "new ocr"),
            "new ocr"
        );
    }

    #[test]
    fn blank_recognition_leaves_the_typed_text() {
        assert_eq!(page_text_after_recognition("typed", "", "  \n "), "typed");
    }

    #[test]
    fn surrounding_white_space_and_bom_are_trimmed() {
        assert_eq!(
            page_text_after_recognition("\u{FEFF}  typed  ", "", ""),
            "typed"
        );
    }
}
