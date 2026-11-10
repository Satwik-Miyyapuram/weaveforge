//! The page's text once handwriting has been recognised: the typed text, then the
//! recognised text, with the page's background and figures kept as they were.
//!
//! A port of `pageTextAfterRecognition` in `apps/web/src/features/ink/application/recognise-page.ts`.

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
