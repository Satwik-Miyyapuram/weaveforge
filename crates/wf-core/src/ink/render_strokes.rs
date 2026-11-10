//! The strokes as the one renderer takes them: each colour name resolved through
//! the palette, and the tool carried as the highlighter flag. A port of
//! `apps/web/src/features/ink/ui/ink-render-strokes.ts`.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use super::ink_svg::{InkSvgPalette, palette_css};

/// The render inputs of one stored stroke: its colour name, tool and nib width.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkRenderSource {
    /// The colour name, resolved through the palette.
    pub colour: String,
    /// The tool name; `highlighter` draws wide and translucent.
    pub tool: String,
    /// Nib width, in the same space as the stroke's points.
    pub width: f64,
}

/// One stroke as the renderer draws it. `at` is its position in the source list,
/// so the caller can take the points from the stroke it already holds.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkRenderStroke {
    /// Position of the stroke in the source list.
    pub at: u32,
    /// Nib width, in the same space as the stroke's points.
    pub width: f64,
    /// A resolved CSS colour, `rgb(r, g, b)`.
    pub colour: String,
    /// Wide and translucent, drawn over the pen.
    pub highlighter: bool,
}

/// The strokes the renderer draws, in source order. Positions in `hidden` are
/// left out. Each colour name resolves through `palette`, falling back to the
/// `text` entry.
#[must_use]
pub fn to_render_strokes(
    strokes: &[InkRenderSource],
    palette: &InkSvgPalette,
    hidden: &[usize],
) -> Vec<InkRenderStroke> {
    let hidden: BTreeSet<usize> = hidden.iter().copied().collect();
    strokes
        .iter()
        .enumerate()
        .filter(|(at, _)| !hidden.contains(at))
        .map(|(at, stroke)| InkRenderStroke {
            at: u32::try_from(at).unwrap_or(u32::MAX),
            width: stroke.width,
            colour: palette_css(palette, &stroke.colour),
            highlighter: stroke.tool == "highlighter",
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{InkRenderSource, to_render_strokes};
    use crate::ink::ink_svg::InkSvgPalette;

    fn stroke(colour: &str, tool: &str, width: f64) -> InkRenderSource {
        InkRenderSource {
            colour: colour.to_owned(),
            tool: tool.to_owned(),
            width,
        }
    }

    fn palette() -> InkSvgPalette {
        BTreeMap::from([
            ("black".to_owned(), [0.0, 0.0, 0.0]),
            ("yellow".to_owned(), [1.0, 1.0, 0.0]),
            ("red".to_owned(), [1.0, 0.0, 0.0]),
            ("blue".to_owned(), [0.0, 0.0, 1.0]),
            ("text".to_owned(), [0.13, 0.14, 0.16]),
        ])
    }

    // resolves colours through the palette and flags highlighters
    #[test]
    fn resolves_colours_through_the_palette_and_flags_highlighters() {
        let out = to_render_strokes(
            &[stroke("black", "pen", 4.0), stroke("yellow", "highlighter", 4.0)],
            &palette(),
            &[],
        );
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].colour, "rgb(0, 0, 0)");
        assert!(!out[0].highlighter);
        assert_eq!(out[1].colour, "rgb(255, 255, 0)");
        assert!(out[1].highlighter);
        assert!((out[0].width - 4.0).abs() < f64::EPSILON);
    }

    // leaves out hidden positions
    #[test]
    fn leaves_out_hidden_positions() {
        let out = to_render_strokes(
            &[
                stroke("black", "pen", 1.0),
                stroke("red", "pen", 1.0),
                stroke("blue", "pen", 1.0),
            ],
            &palette(),
            &[0, 2],
        );
        let ats: Vec<u32> = out.iter().map(|s| s.at).collect();
        assert_eq!(ats, vec![1]);
        assert_eq!(out[0].colour, "rgb(255, 0, 0)");
    }

    // no strokes, or every stroke hidden, is empty
    #[test]
    fn no_strokes_or_every_stroke_hidden_is_empty() {
        assert!(to_render_strokes(&[], &palette(), &[]).is_empty());
        assert!(to_render_strokes(&[stroke("black", "pen", 1.0)], &palette(), &[0]).is_empty());
    }

    // an unknown colour name falls back to the text colour
    #[test]
    fn unknown_colour_falls_back_to_text() {
        let out = to_render_strokes(&[stroke("mauve", "pen", 1.0)], &palette(), &[]);
        assert_eq!(out[0].colour, "rgb(33, 36, 41)");
    }

    // a channel outside 0 to 1 is clamped, and a half rounds up as JS Math.round does
    #[test]
    fn channels_clamp_and_round_half_up() {
        let mut p = palette();
        p.insert("edge".to_owned(), [1.5, -0.2, 0.5]);
        let out = to_render_strokes(&[stroke("edge", "pen", 1.0)], &p, &[]);
        assert_eq!(out[0].colour, "rgb(255, 0, 128)");
    }

    // every position keeps the source order
    #[test]
    fn keeps_source_order_and_positions() {
        let out = to_render_strokes(
            &[stroke("red", "pen", 1.0), stroke("blue", "pen", 2.0)],
            &palette(),
            &[],
        );
        assert_eq!(out.iter().map(|s| s.at).collect::<Vec<_>>(), vec![0, 1]);
        assert_eq!(out[1].colour, "rgb(0, 0, 255)");
    }
}
