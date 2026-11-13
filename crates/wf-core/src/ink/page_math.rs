//! The ink page's pure helpers: the fit, the selection's text and the figure hit
//! tests. A port of `apps/web/src/features/ink/ui/ink-page-math.ts`.

use std::collections::HashSet;

use serde::Deserialize;

use super::clip_to_area::Point;

/// The fit: how many CSS pixels one 0.1 mm unit is worth, `container_width /
/// page_width`. A pane with no width yet fits at `1`.
#[must_use]
pub fn fit_scale(container_width: f64, page_width: f64) -> f64 {
    if !(container_width > 0.0) {
        return 1.0;
    }
    container_width / page_width
}

/// One line of recognised text on a page, with the strokes it is written in.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TextLine {
    /// The recognised text; an absent or empty line contributes nothing.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub text: Option<String>,
    /// Index of the first stroke of the line.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub stroke_start: usize,
    /// Number of strokes in the line.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub stroke_count: usize,
}

/// The lines the chosen strokes belong to, as text, one per line.
#[must_use]
pub fn selected_text(lines: &[TextLine], indices: &[usize]) -> String {
    let chosen: HashSet<usize> = indices.iter().copied().collect();
    let mut out: Vec<&str> = Vec::new();
    for line in lines {
        let Some(text) = line.text.as_deref().filter(|t| !t.is_empty()) else {
            continue;
        };
        let end = line.stroke_start + line.stroke_count;
        if (line.stroke_start..end).any(|i| chosen.contains(&i)) {
            out.push(text);
        }
    }
    out.join("\n")
}

/// A figure's box on the page, in 0.1 mm.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct HitBox {
    /// Left edge.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub x: f64,
    /// Top edge.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub y: f64,
    /// Width.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub w: f64,
    /// Height.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub h: f64,
}

fn holds(one: HitBox, at: Point) -> bool {
    at.x >= one.x && at.x <= one.x + one.w && at.y >= one.y && at.y <= one.y + one.h
}

/// The topmost figure whose box holds `at`, edges included, ignoring `skip`.
/// `None` for no figure there.
#[must_use]
pub fn figure_under(figures: &[Option<HitBox>], at: Point, skip: Option<usize>) -> Option<usize> {
    (0..figures.len())
        .rev()
        .find(|&index| skip != Some(index) && figures[index].is_some_and(|one| holds(one, at)))
}

/// The figure a double-click opens: the first press and every later press
/// and the click itself land inside one box. A near miss, or a press that
/// started elsewhere, opens nothing.
#[must_use]
pub fn double_click_figure(
    figures: &[Option<HitBox>],
    points: &[Point],
    skip: Option<usize>,
) -> Option<usize> {
    let first = figure_under(figures, *points.first()?, skip)?;
    points
        .iter()
        .all(|&p| figure_under(figures, p, skip) == Some(first))
        .then_some(first)
}

#[cfg(test)]
mod tests {
    use super::{HitBox, TextLine, double_click_figure, figure_under, fit_scale, selected_text};
    use crate::ink::clip_to_area::Point;

    fn at(x: f64, y: f64) -> Point {
        Point { x, y }
    }

    fn boxed(x: f64, y: f64, w: f64, h: f64) -> Option<HitBox> {
        Some(HitBox { x, y, w, h })
    }

    #[test]
    fn the_fit_is_the_container_over_the_page() {
        assert_eq!(fit_scale(2100.0, 2100.0), 1.0);
        assert_eq!(
            fit_scale(0.0, 2100.0),
            1.0,
            "a pane with no width fits at one"
        );
    }

    #[test]
    fn the_text_of_a_line_is_chosen_by_any_of_its_strokes() {
        let lines = [
            TextLine {
                text: Some("first".into()),
                stroke_start: 0,
                stroke_count: 2,
            },
            TextLine {
                text: Some("second".into()),
                stroke_start: 2,
                stroke_count: 2,
            },
            TextLine {
                text: None,
                stroke_start: 4,
                stroke_count: 1,
            },
        ];
        assert_eq!(selected_text(&lines, &[1]), "first");
        assert_eq!(selected_text(&lines, &[1, 3]), "first\nsecond");
        assert_eq!(selected_text(&lines, &[4]), "");
    }

    #[test]
    fn the_topmost_figure_holding_the_point_wins_and_edges_count() {
        let figures = [
            boxed(0.0, 0.0, 100.0, 100.0),
            boxed(120.0, 120.0, 50.0, 50.0),
        ];
        assert_eq!(figure_under(&figures, at(130.0, 130.0), None), Some(1));
        assert_eq!(figure_under(&figures, at(100.0, 100.0), None), Some(0));
        assert_eq!(figure_under(&figures, at(110.0, 110.0), None), None);
    }

    #[test]
    fn a_skipped_figure_is_not_hit() {
        let figures = [boxed(0.0, 0.0, 100.0, 100.0)];
        assert_eq!(figure_under(&figures, at(10.0, 10.0), Some(0)), None);
    }

    #[test]
    fn a_double_click_needs_every_press_in_the_same_box() {
        let figures = [boxed(0.0, 0.0, 100.0, 100.0)];
        let inside = at(50.0, 50.0);
        assert_eq!(
            double_click_figure(&figures, &[inside, inside, inside], None),
            Some(0)
        );
        assert_eq!(
            double_click_figure(&figures, &[at(150.0, 150.0)], None),
            None
        );
        assert_eq!(
            double_click_figure(&figures, &[inside, inside], Some(0)),
            None
        );
        assert_eq!(double_click_figure(&figures, &[], None), None);
    }
}
