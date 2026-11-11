//! Create-tool rules (`reader::create_tool`). Ports of
//! `apps/web/src/features/reader/application/parts.ts`
//! (`isInkTool`, `toolOwnsThePage`, `isDismissTap`) and
//! `apps/web/src/features/reader/ui/pdf-reader/colour-tools.ts`
//! (`colourToolFor`, `markColourTool`). Tools are plain tool names, as the app sends them.

use serde::{Deserialize, Serialize};

/// How far a tap may drift, in CSS pixels, and still count as a tap.
const TAP_SLOP_PX: f64 = 6.0;
/// The longest press that still counts as a tap, in milliseconds.
const TAP_MAX_MS: f64 = 400.0;

/// A pointer press on the page: where, and when.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PagePress {
    /// X.
    pub x: f64,
    /// Y.
    pub y: f64,
    /// Time.
    pub time: f64,
}

/// `ink` and `highlighter` draw on the page.
#[must_use]
pub fn is_ink_tool(tool: &str) -> bool {
    matches!(tool, "ink" | "highlighter")
}

/// Every tool but `select` takes the page away from the browser's text selection.
#[must_use]
pub fn tool_owns_the_page(tool: &str) -> bool {
    tool != "select"
}

/// A short press that barely moved, off an open create bar, dismisses the bar.
#[must_use]
pub fn is_dismiss_tap(down: Option<PagePress>, up: PagePress, bar_open: bool) -> bool {
    let Some(down) = down else {
        return false;
    };
    if !bar_open {
        return false;
    }
    (up.x - down.x).hypot(up.y - down.y) <= TAP_SLOP_PX && up.time - down.time <= TAP_MAX_MS
}

/// The tool whose colour the create actions use right now.
#[must_use]
pub fn colour_tool_for(pen_open: bool, pen_tool: &str, picked_tool: &str) -> &'static str {
    if pen_open {
        return if pen_tool == "highlighter" {
            "highlighter"
        } else {
            "pen"
        };
    }
    match picked_tool {
        "highlighter" => "highlighter",
        "text" => "text",
        // The paper's own selection makes highlights, so its colour is the highlight's.
        "select" => "highlight",
        _ => "pen",
    }
}

/// The tool whose quick colours offer a recolour of this mark.
#[must_use]
pub fn mark_colour_tool(mark_type: &str) -> &'static str {
    match mark_type {
        "highlight" => "highlight",
        "underline" => "underline",
        "text" => "text",
        _ => "pen",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOWN: PagePress = PagePress {
        x: 100.0,
        y: 100.0,
        time: 0.0,
    };

    #[test]
    fn only_ink_and_highlighter_are_ink_tools() {
        assert!(is_ink_tool("ink"));
        assert!(is_ink_tool("highlighter"));
        assert!(!is_ink_tool("select"));
        assert!(!is_ink_tool("lasso"));
    }

    #[test]
    fn every_tool_but_select_owns_the_page() {
        assert!(!tool_owns_the_page("select"));
        for tool in ["lasso", "ink", "highlighter", "erase", "image", "text"] {
            assert!(tool_owns_the_page(tool), "{tool}");
        }
    }

    #[test]
    fn one_short_tap_off_an_open_bar_dismisses_it() {
        let up = PagePress {
            x: 102.0,
            y: 101.0,
            time: 120.0,
        };
        assert!(is_dismiss_tap(Some(DOWN), up, true));
        assert!(
            !is_dismiss_tap(Some(DOWN), up, false),
            "no bar, nothing to dismiss"
        );
        assert!(
            !is_dismiss_tap(
                Some(DOWN),
                PagePress {
                    x: 160.0,
                    y: 100.0,
                    time: 120.0
                },
                true
            ),
            "a drag is a new selection"
        );
        assert!(
            !is_dismiss_tap(
                Some(DOWN),
                PagePress {
                    x: 100.0,
                    y: 100.0,
                    time: 900.0
                },
                true
            ),
            "a long press selects words"
        );
        assert!(!is_dismiss_tap(
            None,
            PagePress {
                x: 100.0,
                y: 100.0,
                time: 10.0
            },
            true
        ));
    }

    #[test]
    fn the_pen_colour_is_drawn_with_while_the_pen_bar_is_up() {
        assert_eq!(colour_tool_for(true, "ink", "select"), "pen");
        assert_eq!(colour_tool_for(true, "lasso", "select"), "pen");
        assert_eq!(
            colour_tool_for(true, "highlighter", "select"),
            "highlighter"
        );
    }

    #[test]
    fn without_the_pen_bar_the_picked_tool_chooses_its_colour() {
        assert_eq!(colour_tool_for(false, "ink", "text"), "text");
        assert_eq!(colour_tool_for(false, "ink", "select"), "highlight");
        assert_eq!(colour_tool_for(false, "ink", "highlighter"), "highlighter");
        assert_eq!(colour_tool_for(false, "ink", "lasso"), "pen");
    }

    #[test]
    fn each_mark_is_recoloured_from_its_own_tools_quick_colours() {
        assert_eq!(mark_colour_tool("highlight"), "highlight");
        assert_eq!(mark_colour_tool("underline"), "underline");
        assert_eq!(mark_colour_tool("ink"), "pen");
        assert_eq!(mark_colour_tool("text"), "text");
        assert_eq!(mark_colour_tool("note"), "pen");
    }
}
