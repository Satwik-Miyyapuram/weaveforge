//! Hashtag edits on a paper's note body, ported from
//! `apps/web/src/features/papers/lib/note-tags.ts` (`tagToHashtag`,
//! `appendTagHashtags`, `removeHashtagFromBody`).
//!
//! Tags live in the note markdown as `#hashtags`; these keep the body the
//! single source of truth for them.

use std::collections::HashSet;

use crate::papers::paper::{extract_hashtags, is_tag_char};
use crate::search::js_text::is_js_whitespace;

/// A tag name as one `#hashtag`: lowercase, runs of characters that cannot
/// appear in a tag become one `-`, and no leading or trailing `-`. Empty when
/// nothing is left.
#[must_use]
pub fn tag_to_hashtag(name: &str) -> String {
    let mut slug = String::new();
    for ch in name.trim().to_lowercase().chars() {
        if ch == '_' || (ch != '-' && is_tag_char(ch)) {
            slug.push(ch);
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        String::new()
    } else {
        format!("#{slug}")
    }
}

/// Append a `#hashtag` line for each tag name the body does not already have.
/// Returns the body unchanged when there is nothing to add.
#[must_use]
pub fn append_tag_hashtags(body: &str, tag_names: &[String]) -> String {
    let mut have: HashSet<String> = extract_hashtags(Some(body)).into_iter().collect();
    let mut lines = Vec::new();
    for name in tag_names {
        let hashtag = tag_to_hashtag(name);
        if hashtag.is_empty() || have.contains(&hashtag[1..]) {
            continue;
        }
        let _ = have.insert(hashtag[1..].to_string());
        lines.push(hashtag);
    }
    if lines.is_empty() {
        return body.to_string();
    }
    let base = body.trim_end_matches(is_js_whitespace);
    let head = if base.is_empty() {
        String::new()
    } else {
        format!("{base}\n\n")
    };
    format!("{head}{}\n", lines.join("\n"))
}

/// Remove every `#hashtag` in the body whose normalized name equals `tag`,
/// then tidy the whitespace the removal leaves behind.
#[must_use]
pub fn remove_hashtag_from_body(body: &str, tag: &str) -> String {
    let wanted = tag.trim().to_lowercase();
    let stripped = strip_hashtag(body, &wanted);
    let no_blanks = strip_trailing_blanks_per_line(&stripped);
    let collapsed = collapse_blank_runs(&no_blanks);
    let without_end = collapsed.trim_end_matches(is_js_whitespace);
    let ended = if without_end.len() == collapsed.len() {
        collapsed
    } else {
        format!("{without_end}\n")
    };
    ended.trim_start_matches('\n').to_string()
}

/// Drop each `#` run whose lowercase form equals `wanted`; keep every other run.
fn strip_hashtag(body: &str, wanted: &str) -> String {
    let mut out = String::with_capacity(body.len());
    let mut rest = body;
    while let Some(pos) = rest.find('#') {
        out.push_str(&rest[..pos]);
        let after = &rest[pos + 1..];
        let run_len: usize = after
            .chars()
            .take_while(|&ch| is_tag_char(ch))
            .map(char::len_utf8)
            .sum();
        let run = &after[..run_len];
        if run_len == 0 || run.to_lowercase() != wanted {
            out.push('#');
            out.push_str(run);
        }
        rest = &after[run_len..];
    }
    out.push_str(rest);
    out
}

/// Remove spaces and tabs at the end of every line (JS `/[ \t]+$/gm`).
/// Line ends are `\n`, `\r`, U+2028 and U+2029, as in JavaScript.
fn strip_trailing_blanks_per_line(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if matches!(ch, '\n' | '\r' | '\u{2028}' | '\u{2029}') {
            let kept = out.trim_end_matches([' ', '\t']).len();
            out.truncate(kept);
        }
        out.push(ch);
    }
    let kept = out.trim_end_matches([' ', '\t']).len();
    out.truncate(kept);
    out
}

/// Keep at most two newlines in a row (JS `/\n{3,}/g` to `"\n\n"`).
fn collapse_blank_runs(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut newlines = 0_usize;
    for ch in text.chars() {
        if ch == '\n' {
            newlines += 1;
            if newlines > 2 {
                continue;
            }
        } else {
            newlines = 0;
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn tag_becomes_a_slug_hashtag() {
        assert_eq!(tag_to_hashtag("  Machine Learning! "), "#machine-learning");
        assert_eq!(tag_to_hashtag("a__b--c"), "#a__b-c");
        assert_eq!(tag_to_hashtag("Café 2026"), "#café-2026");
    }

    #[test]
    fn tag_with_no_usable_characters_is_empty() {
        assert_eq!(tag_to_hashtag("  ...  "), "");
        assert_eq!(tag_to_hashtag(""), "");
    }

    #[test]
    fn append_adds_missing_tags_once() {
        let out = append_tag_hashtags(
            "Notes #rust\n",
            &tags(&["Rust", "Zotero Import", "Zotero Import"]),
        );
        assert_eq!(out, "Notes #rust\n\n#zotero-import\n");
    }

    #[test]
    fn append_to_empty_body_has_no_leading_blank_lines() {
        assert_eq!(append_tag_hashtags("", &tags(&["ml"])), "#ml\n");
    }

    #[test]
    fn append_with_nothing_to_add_keeps_body() {
        let body = "text  \n";
        assert_eq!(append_tag_hashtags(body, &tags(&["  "])), body);
        assert_eq!(append_tag_hashtags(body, &[]), body);
    }

    #[test]
    fn remove_drops_matching_tag_case_insensitively() {
        assert_eq!(
            remove_hashtag_from_body("Read #ML today #other\n", "ml"),
            "Read  today #other\n"
        );
        assert_eq!(remove_hashtag_from_body("#ML", "  ml "), "");
    }

    #[test]
    fn remove_keeps_longer_tags_that_only_start_the_same() {
        assert_eq!(remove_hashtag_from_body("#mlx and #ml", "ml"), "#mlx and");
    }

    #[test]
    fn remove_tidies_trailing_blanks_and_extra_newlines() {
        assert_eq!(
            remove_hashtag_from_body("a #x  \n\n\n\nb\n\n\n", "x"),
            "a\n\nb\n"
        );
        assert_eq!(remove_hashtag_from_body("\n\n#x\nb", "x"), "b");
    }
}
