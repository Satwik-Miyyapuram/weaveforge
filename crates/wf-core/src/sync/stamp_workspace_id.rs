//! Port of `packages/core/src/workspace/stamp-workspace-id.ts`: writes a
//! `weaveforge-id` line into a hand-written file's frontmatter. Offsets are byte
//! offsets; every slice point sits at an ASCII fence or newline, so the output
//! matches the UTF-16 positions the TS slices at.

use crate::search::js_text::is_js_whitespace;

/// The id line, spelled as the serializer spells it.
const ID_KEY: &str = "weaveforge-id";

/// Add `weaveforge-id` to a file's frontmatter.
///
/// Returns `None` when the file already claims an id, so a caller can tell
/// "stamped" from "left alone" without comparing text.
#[must_use]
pub fn stamp_workspace_id(content: &str, id: &str) -> Option<String> {
    // A byte-order mark hides the opening fence; set it aside and put it back.
    if let Some(rest) = content.strip_prefix('\u{feff}') {
        return stamp_workspace_id(rest, id).map(|stamped| format!("\u{feff}{stamped}"));
    }
    let newline = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let fence = format!("---{newline}");

    if !content.starts_with(fence.as_str()) {
        // No frontmatter at all: give it one, body after a blank line.
        return Some(with_new_frontmatter(content, id, newline));
    }

    // Search for the closing fence from the dashes, as `indexOf` does in the TS.
    let search_from = fence.len() - newline.len();
    let closing = format!("{newline}---");
    let found = content
        .get(search_from..)
        .and_then(|tail| tail.find(closing.as_str()))
        .map(|at| at + search_from);
    let Some(end) = found else {
        // An opening fence with no close is body, not frontmatter to edit.
        return Some(with_new_frontmatter(content, id, newline));
    };

    let head = content.get(fence.len()..end + newline.len()).unwrap_or("");
    if claims_id(head) {
        return None;
    }
    let body = content.get(fence.len()..).unwrap_or("");
    Some(format!("{fence}{ID_KEY}: {id}{newline}{body}"))
}

fn with_new_frontmatter(content: &str, id: &str, newline: &str) -> String {
    format!("---{newline}{ID_KEY}: {id}{newline}---{newline}{newline}{content}")
}

/// JS `/^weaveforge-id\s*:/m` over the frontmatter head: `^` also matches after
/// any line terminator, and `\s*` may span lines.
fn claims_id(head: &str) -> bool {
    let line_starts = std::iter::once(0).chain(
        head.char_indices()
            .filter(|&(_, ch)| matches!(ch, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
            .map(|(at, ch)| at + ch.len_utf8()),
    );
    line_starts.filter_map(|at| head.get(at..)).any(|rest| {
        rest.strip_prefix(ID_KEY)
            .is_some_and(|after| after.trim_start_matches(is_js_whitespace).starts_with(':'))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::deserialize::parse_workspace_file;

    #[test]
    fn a_hand_written_file_with_frontmatter_keeps_it_plus_an_id() {
        let stamped = stamp_workspace_id("---\ntitle: My idea\ntags:\n  - a\n---\n\nthe body\n", "n1");
        assert_eq!(
            stamped.as_deref(),
            Some("---\nweaveforge-id: n1\ntitle: My idea\ntags:\n  - a\n---\n\nthe body\n")
        );
    }

    #[test]
    fn a_file_with_no_frontmatter_gets_one_and_keeps_every_word_of_its_body() {
        let stamped = stamp_workspace_id("# My idea\n\nthe body\n", "n1");
        assert_eq!(
            stamped.as_deref(),
            Some("---\nweaveforge-id: n1\n---\n\n# My idea\n\nthe body\n")
        );
    }

    #[test]
    fn a_file_that_already_claims_an_id_is_left_alone() {
        let content = "---\nweaveforge-id: n9\ntitle: Mine\n---\n\nbody\n";
        assert_eq!(stamp_workspace_id(content, "n1"), None);
    }

    #[test]
    fn an_unclosed_fence_is_body_not_frontmatter_to_edit() {
        let stamped = stamp_workspace_id("---\nnot really frontmatter\n", "n1");
        assert!(stamped.is_some_and(|s| s.starts_with("---\nweaveforge-id: n1\n---\n\n---\n")));
    }

    #[test]
    fn crlf_stays_crlf() {
        let stamped = stamp_workspace_id("---\r\ntitle: Mine\r\n---\r\n\r\nbody\r\n", "n1");
        assert_eq!(
            stamped.as_deref(),
            Some("---\r\nweaveforge-id: n1\r\ntitle: Mine\r\n---\r\n\r\nbody\r\n")
        );
        assert!(!stamped.unwrap_or_default().contains("\n\n"));
    }

    #[test]
    fn the_stamped_file_parses_back_as_that_entity() {
        let stamped = stamp_workspace_id("---\ntitle: My idea\n---\n\nthe body\n", "n1")
            .unwrap_or_default();
        let parsed = parse_workspace_file("notes/My idea.md", &stamped)
            .expect("stamped file parses as an entity");
        assert_eq!(parsed.id.as_deref(), Some("n1"));
        assert_eq!(parsed.title, "My idea");
        assert_eq!(parsed.body.trim(), "the body");
    }
}
