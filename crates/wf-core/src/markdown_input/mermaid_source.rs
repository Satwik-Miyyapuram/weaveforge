//! Mermaid source and cache ids for the renderer (TS: `lib/mermaid-render.ts`).

use crate::markdown_mermaid_labels::quote_awkward_labels;
use crate::search::js_text::is_js_whitespace;

/// The source the renderer draws: JS-trimmed, with labels Mermaid cannot parse quoted.
#[must_use]
pub fn render_source(code: &str) -> String {
    quote_awkward_labels(code.trim_matches(is_js_whitespace))
}

/// The id a diagram's SVG gets from its source (TS `diagramId`), so the same fence renders to the
/// same markup every time. A 31-hash over UTF-16 code units, wrapped to 32 bits, in base 36.
#[must_use]
pub fn diagram_id(source: &str) -> String {
    let mut hash: i32 = 0;
    for unit in source.encode_utf16() {
        hash = hash.wrapping_mul(31).wrapping_add(i32::from(unit));
    }
    format!("wf-mermaid-{}", to_base36(hash as u32))
}

/// Lowercase base-36 digits of `n`, as `Number.prototype.toString(36)` writes them.
fn to_base36(mut n: u32) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".to_owned();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(char::from(DIGITS[(n % 36) as usize]));
        n /= 36;
    }
    out.iter().rev().collect()
}

#[cfg(test)]
mod tests {
    use super::{diagram_id, render_source};
    use crate::markdown_mermaid_labels::quote_awkward_labels;

    #[test]
    fn render_source_trims_js_whitespace_then_quotes_labels() {
        assert_eq!(render_source("  a  "), "a");
        let src = " graph TD\n  A[q(z|x)] ";
        assert_eq!(render_source(src), quote_awkward_labels("graph TD\n  A[q(z|x)]"));
    }

    #[test]
    fn diagram_id_hashes_to_base36() {
        assert_eq!(diagram_id(""), "wf-mermaid-0");
        assert_eq!(diagram_id("a"), "wf-mermaid-2p");
        assert_eq!(diagram_id("ab"), "wf-mermaid-2e9");
    }

    #[test]
    fn diagram_id_hashes_utf16_code_units() {
        // U+1F600 is the surrogate pair D83D DE00: 0xD83D, then 0xD83D * 31 + 0xDE00.
        assert_eq!(diagram_id("\u{1F600}"), "wf-mermaid-11zz7");
    }
}
