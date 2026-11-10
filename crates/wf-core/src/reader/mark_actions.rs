//! What the popover on a tapped mark offers. Port of `markActions` and `markPopoverShown` in
//! `apps/web/src/features/reader/application/mark-actions.ts`.

use serde::{Deserialize, Serialize};

use super::text_units::is_js_space;

/// What the popover on a tapped mark offers (TS `MarkActions`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MarkActions {
    /// The label over the popover: what the mark is.
    pub kind: String,
    /// Whether the popover offers colour choices.
    pub colour: bool,
    /// The comment button's label, or `None` when the mark takes no comment.
    pub comment: Option<String>,
    /// The composer's starting text: the comment already there.
    pub prefill: String,
}

/// The fields of an annotation the popover decision reads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MarkTarget {
    /// The annotation's type: `highlight`, `underline`, `note`, `image`, `text` or `ink`.
    #[serde(rename = "type")]
    pub annotation_type: String,
    /// Where the mark came from; only `local` marks take actions.
    pub origin: String,
    /// The annotation's comment text.
    #[serde(default)]
    pub comment: String,
}

/// Highlights, underlines, comments and clips take colour, comment and delete; a text box takes
/// delete only. Ink has the lasso, a placed picture its own editor, and Zotero's marks are
/// read-only. Returns `None` for those, and for types it does not know.
#[must_use]
pub fn mark_actions(target: &MarkTarget) -> Option<MarkActions> {
    if target.origin != "local" {
        return None;
    }
    if target.annotation_type == "text" {
        return Some(MarkActions {
            kind: "Text box".to_owned(),
            colour: false,
            comment: None,
            prefill: String::new(),
        });
    }
    if target.annotation_type == "ink" || picture_path(target).is_some() {
        return None;
    }
    let kind = match target.annotation_type.as_str() {
        "highlight" => "Highlight",
        "underline" => "Underline",
        "note" => "Comment",
        "image" => "Clip",
        _ => return None,
    };
    let has_comment = !target.comment.trim_matches(is_js_space).is_empty();
    let prefill = if has_comment {
        target.comment.clone()
    } else {
        String::new()
    };
    Some(MarkActions {
        kind: kind.to_owned(),
        colour: true,
        comment: Some(
            if has_comment {
                "Edit comment"
            } else {
                "Comment"
            }
            .to_owned(),
        ),
        prefill,
    })
}

/// A text box's popover shows under Select or Text; other marks under any tool.
#[must_use]
pub fn mark_popover_shown(annotation_type: &str, tool: &str) -> bool {
    annotation_type != "text" || tool == "select" || tool == "text"
}

/// The stored file behind a placed picture, read from its `![picture ...](path)` comment. Only
/// `image` marks can be pictures.
#[must_use]
pub fn picture_path(target: &MarkTarget) -> Option<String> {
    if target.annotation_type != "image" {
        return None;
    }
    let pattern =
        regex_lite::Regex::new(r"^!\[picture((?:\s+[a-z]=[^\s\]]+)*)\]\(([^()\s]+)\)$").ok()?;
    let captures = pattern.captures(target.comment.trim_matches(is_js_space))?;
    captures.get(2).map(|path| path.as_str().to_owned())
}
