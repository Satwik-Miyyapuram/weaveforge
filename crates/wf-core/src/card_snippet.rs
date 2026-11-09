//! Plain-text preview of a markdown body for entity list cards (wf-core `card_snippet`).
//! Ported from `apps/web/src/lib/card-snippet.ts`. Each TS regex step is a hand scanner here,
//! because `regex-lite` has no lookaround and JS `^`/`$` multiline rules differ from it.

use crate::papers::paper::is_empty_paper_summary;
use crate::search::js_text::{is_js_whitespace, utf16_len};

/// Plain-text preview of `body`, markup stripped, cut to `max` UTF-16 units plus `…`.
///
/// Returns an empty string for an empty or placeholder summary.
#[must_use]
pub fn card_snippet(body: &str, max: usize) -> String {
    let text = strip_front_matter(body);
    let text = drop_heading_and_table_lines(text);
    let text = strip_comments(&text);
    let text = strip_complete_images(&text);
    let text = strip_truncated_image(&text);
    let text = unwrap_links(&text);
    let text = markup_runs_to_space(&text);
    let text = collapse_whitespace(&text);
    let text = text.trim_matches(is_js_whitespace);
    if is_empty_paper_summary(Some(text)) {
        return String::new();
    }
    truncate(text, max)
}

/// `^---\r?\n[^]*?\r?\n---[ \t]*(?:\r?\n|$)`: a leading front-matter block, removed whole.
fn strip_front_matter(body: &str) -> &str {
    let bytes = body.as_bytes();
    if !bytes.starts_with(b"---") {
        return body;
    }
    let mut open = 3;
    if bytes.get(open) == Some(&b'\r') {
        open += 1;
    }
    if bytes.get(open) != Some(&b'\n') {
        return body;
    }
    let start = open + 1;
    for (k, &b) in bytes.iter().enumerate().skip(start) {
        if b == b'\n' {
            if let Some(end) = closing_fence_end(bytes, k + 1) {
                return &body[end..];
            }
        }
    }
    body
}

/// End of a closing `---` fence starting at `dashes`, including its trailing newline.
fn closing_fence_end(bytes: &[u8], dashes: usize) -> Option<usize> {
    if !bytes.get(dashes..)?.starts_with(b"---") {
        return None;
    }
    let mut i = dashes + 3;
    while matches!(bytes.get(i), Some(b' ' | b'\t')) {
        i += 1;
    }
    match bytes.get(i..) {
        None | Some([]) => Some(bytes.len()),
        Some([b'\n', ..]) => Some(i + 1),
        Some([b'\r', b'\n', ..]) => Some(i + 2),
        Some(_) => None,
    }
}

/// `^[ \t]*(?:#{1,6}[ \t].*|\|.*)$` with the `m` flag: heading and table lines become empty.
/// JS line terminators are `\n`, `\r`, U+2028 and U+2029; the terminators themselves stay.
fn drop_heading_and_table_lines(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut line_start = 0;
    for (i, ch) in text.char_indices() {
        if is_line_terminator(ch) {
            push_unless_heading_or_table(&mut out, &text[line_start..i]);
            out.push(ch);
            line_start = i + ch.len_utf8();
        }
    }
    push_unless_heading_or_table(&mut out, &text[line_start..]);
    out
}

fn push_unless_heading_or_table(out: &mut String, line: &str) {
    if !is_heading_or_table(line) {
        out.push_str(line);
    }
}

fn is_heading_or_table(line: &str) -> bool {
    let rest = line.trim_start_matches([' ', '\t']);
    if rest.starts_with('|') {
        return true;
    }
    let hashes = rest.bytes().take_while(|&b| b == b'#').count();
    (1..=6).contains(&hashes) && matches!(rest.as_bytes().get(hashes), Some(b' ' | b'\t'))
}

const fn is_line_terminator(ch: char) -> bool {
    matches!(ch, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// `<!--[^]*?(?:-->|$)`: a comment through its first `-->`, or to the end when unclosed.
fn strip_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<!--") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 4..];
        match after.find("-->") {
            Some(end) => rest = &after[end + 3..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

/// `!\[[^\]]*\]\([^)]*\)` (global): complete images are removed.
fn strip_complete_images(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find("![") {
        match complete_image_len(&rest[i..]) {
            Some(len) => {
                out.push_str(&rest[..i]);
                rest = &rest[i + len..];
            }
            None => {
                out.push_str(&rest[..i + 2]);
                rest = &rest[i + 2..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Byte length of an image `![alt](src)` at the start of `s`, when it is complete.
fn complete_image_len(s: &str) -> Option<usize> {
    let alt_end = s[2..].find(']')? + 2;
    let after = &s[alt_end + 1..];
    if !after.starts_with('(') {
        return None;
    }
    let close = after[1..].find(')')?;
    Some(alt_end + 3 + close)
}

/// `!\[[^\]]*(?:\]\([^)]*)?$` (first match, anchored to the end): an image cut off by the
/// preview's length limit runs to the end of the text.
fn strip_truncated_image(text: &str) -> String {
    let mut from = 0;
    while let Some(off) = text[from..].find("![") {
        let i = from + off;
        if is_truncated_image_tail(&text[i..]) {
            return text[..i].to_string();
        }
        from = i + 2;
    }
    text.to_string()
}

fn is_truncated_image_tail(s: &str) -> bool {
    let alt = &s[2..];
    match alt.find(']') {
        None => true,
        Some(p) => {
            let after = &alt[p + 1..];
            after.starts_with('(') && !after[1..].contains(')')
        }
    }
}

/// `\[([^\]]+)\]\([^)]*\)` (global, replaced by `$1`): `[label](url)` becomes `label`.
fn unwrap_links(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find('[') {
        match link_parts(&rest[i..]) {
            Some((label_len, total)) => {
                out.push_str(&rest[..i]);
                out.push_str(&rest[i + 1..i + 1 + label_len]);
                rest = &rest[i + total..];
            }
            None => {
                out.push_str(&rest[..=i]);
                rest = &rest[i + 1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// For a `[label](url)` at the start of `s`: the label's byte length and the whole link's length.
fn link_parts(s: &str) -> Option<(usize, usize)> {
    let label_end = s[1..].find(']')? + 1;
    if label_end == 1 || s.as_bytes().get(label_end + 1) != Some(&b'(') {
        return None;
    }
    let paren = s[label_end + 2..].find(')')? + label_end + 2;
    Some((label_end - 1, paren + 1))
}

/// `[#>*_`~]+` (global, each run to one space): markdown emphasis and heading marks.
fn markup_runs_to_space(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_run = false;
    for ch in text.chars() {
        if matches!(ch, '#' | '>' | '*' | '_' | '`' | '~') {
            if !in_run {
                out.push(' ');
                in_run = true;
            }
        } else {
            in_run = false;
            out.push(ch);
        }
    }
    out
}

/// `\s+` (global, each run to one space), with JS whitespace.
fn collapse_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_run = false;
    for ch in text.chars() {
        if is_js_whitespace(ch) {
            if !in_run {
                out.push(' ');
                in_run = true;
            }
        } else {
            in_run = false;
            out.push(ch);
        }
    }
    out
}

/// `text.length > max ? text.slice(0, max) + "…" : text`, counting UTF-16 units.
///
/// A character that straddles the budget is dropped rather than split, because a lone
/// surrogate cannot be held in a Rust string. That can leave the preview one unit shorter
/// than the TypeScript version.
fn truncate(text: &str, max: usize) -> String {
    if utf16_len(text) <= max {
        return text.to_string();
    }
    let mut used = 0;
    let mut end = 0;
    for (i, ch) in text.char_indices() {
        let width = ch.len_utf16();
        if used + width > max {
            break;
        }
        used += width;
        end = i + ch.len_utf8();
    }
    format!("{}…", &text[..end])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::papers::paper::NO_SUMMARY;

    #[test]
    fn empty_or_placeholder_summary_is_blank() {
        assert_eq!(card_snippet("", 180), "");
        assert_eq!(card_snippet(NO_SUMMARY, 180), "");
        assert_eq!(card_snippet(&format!("  **{NO_SUMMARY}**  "), 180), "");
    }

    #[test]
    fn written_text_is_markup_stripped_and_cut_to_budget() {
        assert_eq!(card_snippet("# Title\n\nSome *body*", 180), "Some body");
        assert_eq!(card_snippet("abcdef", 3), "abc…");
    }

    #[test]
    fn front_matter_headings_and_tables_are_dropped() {
        let body = [
            "---",
            "title: Draft",
            "tags: [a]",
            "---",
            "# Draft",
            "",
            "| col | col |",
            "| --- | --- |",
            "| 1 | 2 |",
            "",
            "## Method",
            "First real sentence.",
        ]
        .join("\n");
        assert_eq!(card_snippet(&body, 180), "First real sentence.");
    }

    #[test]
    fn crlf_front_matter_is_dropped() {
        assert_eq!(card_snippet("---\r\nt: 1\r\n---\r\nBody", 180), "Body");
    }

    #[test]
    fn horizontal_rule_mid_note_is_not_front_matter() {
        assert_eq!(card_snippet("Intro.\n\n---\n\nMore.", 180), "Intro. --- More.");
    }

    #[test]
    fn unclosed_front_matter_is_kept() {
        assert_eq!(card_snippet("---\nBody only", 180), "--- Body only");
    }

    #[test]
    fn seven_hashes_is_not_a_heading() {
        assert_eq!(card_snippet("####### not heading", 180), "not heading");
    }

    #[test]
    fn images_links_and_comments_are_stripped() {
        assert_eq!(card_snippet("See ![alt](img.png) here", 180), "See here");
        assert_eq!(card_snippet("[label](http://x) end", 180), "label end");
        assert_eq!(card_snippet("a <!-- page 1 --> b", 180), "a b");
    }

    #[test]
    fn truncated_markup_at_the_end_is_stripped() {
        assert_eq!(card_snippet("text ![alt", 180), "text");
        assert_eq!(card_snippet("x <!-- still open", 180), "x");
        assert_eq!(card_snippet("text ![cap](src", 180), "text");
    }

    #[test]
    fn unicode_whitespace_is_trimmed() {
        assert_eq!(card_snippet("\u{00A0}Body\u{2028}", 180), "Body");
    }

    #[test]
    fn budget_counts_utf16_units() {
        assert_eq!(card_snippet("héllo", 3), "hél…");
    }

    #[test]
    fn budget_never_splits_a_surrogate_pair() {
        // The TypeScript slice would keep a lone high surrogate; Rust drops the pair instead.
        assert_eq!(card_snippet("\u{1F642}\u{1F642}", 1), "…");
    }
}
