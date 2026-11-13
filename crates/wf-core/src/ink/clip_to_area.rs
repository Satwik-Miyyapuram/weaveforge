//! The box a stroke may be drawn in, and the cut where the pen leaves it. A
//! port of `apps/web/src/features/ink/application/clip-to-area.ts`.
//!
//! The area is in client pixels. A stroke is cut at the edge it crosses, and
//! the part drawn after the pen returns is a new stroke.

use serde::{Deserialize, Serialize};

/// A box in client pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DrawArea {
    /// Left edge.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub left: f64,
    /// Top edge.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub top: f64,
    /// Right edge.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub right: f64,
    /// Bottom edge.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub bottom: f64,
}

/// A point in client pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Point {
    /// Horizontal position.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub x: f64,
    /// Vertical position.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub y: f64,
}

/// The part of a segment inside an area.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ClippedSegment {
    /// Where the part starts.
    pub from: Point,
    /// Where the part ends.
    pub to: Point,
}

/// Whether a point is inside the area, edges included.
#[must_use]
pub fn point_in_area(area: &DrawArea, x: f64, y: f64) -> bool {
    x >= area.left && x <= area.right && y >= area.top && y <= area.bottom
}

/// The part of a segment inside the area, or `None` for none of it. The
/// Liang-Barsky slab test: each edge narrows the parameter range `[t0, t1]`.
#[must_use]
pub fn clip_segment_to_area(area: &DrawArea, from: Point, to: Point) -> Option<ClippedSegment> {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    let mut t0 = 0.0_f64;
    let mut t1 = 1.0_f64;

    let edges = [
        (-dx, from.x - area.left),
        (dx, area.right - from.x),
        (-dy, from.y - area.top),
        (dy, area.bottom - from.y),
    ];

    for (p, q) in edges {
        if p == 0.0 {
            // Parallel to this edge: either wholly inside that slab, or wholly out.
            if q < 0.0 {
                return None;
            }
            continue;
        }
        let r = q / p;
        if p < 0.0 {
            if r > t1 {
                return None;
            }
            if r > t0 {
                t0 = r;
            }
        } else {
            if r < t0 {
                return None;
            }
            if r < t1 {
                t1 = r;
            }
        }
    }

    Some(ClippedSegment {
        from: Point {
            x: from.x + dx * t0,
            y: from.y + dy * t0,
        },
        to: Point {
            x: from.x + dx * t1,
            y: from.y + dy * t1,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: DrawArea = DrawArea {
        left: 10.0,
        top: 20.0,
        right: 110.0,
        bottom: 220.0,
    };

    fn pt(x: f64, y: f64) -> Point {
        Point { x, y }
    }

    /// Round to the pixel: the clip is a division, so the last bit is float noise.
    fn px(p: Point) -> (i64, i64) {
        (p.x.round() as i64, p.y.round() as i64)
    }

    #[test]
    fn a_point_is_in_the_page_or_it_is_not_edges_included() {
        assert!(point_in_area(&AREA, 50.0, 100.0));
        assert!(point_in_area(&AREA, 10.0, 20.0));
        assert!(point_in_area(&AREA, 110.0, 220.0));
        assert!(!point_in_area(&AREA, 9.0, 100.0));
        assert!(!point_in_area(&AREA, 50.0, 221.0));
    }

    #[test]
    fn a_segment_wholly_inside_is_returned_as_it_is() {
        let clipped = clip_segment_to_area(&AREA, pt(20.0, 30.0), pt(90.0, 200.0));
        assert_eq!(
            clipped,
            Some(ClippedSegment {
                from: pt(20.0, 30.0),
                to: pt(90.0, 200.0),
            })
        );
    }

    #[test]
    fn a_segment_that_runs_off_the_right_edge_is_cut_where_it_crosses() {
        let clipped = clip_segment_to_area(&AREA, pt(50.0, 100.0), pt(200.0, 100.0)).unwrap();
        assert_eq!(clipped.from, pt(50.0, 100.0));
        assert_eq!(clipped.to.x, 110.0);
        assert_eq!(clipped.to.y, 100.0);
    }

    #[test]
    fn a_segment_that_comes_back_in_starts_at_the_edge_it_crossed() {
        let clipped = clip_segment_to_area(&AREA, pt(-40.0, 60.0), pt(60.0, 60.0)).unwrap();
        assert_eq!(clipped.from.x, 10.0);
        assert_eq!(clipped.from.y, 60.0);
        assert_eq!(clipped.to, pt(60.0, 60.0));
    }

    #[test]
    fn a_segment_that_only_passes_over_the_page_is_cut_to_the_crossing_at_both_ends() {
        let clipped = clip_segment_to_area(&AREA, pt(0.0, 0.0), pt(200.0, 200.0)).unwrap();
        assert_eq!(px(clipped.from), (20, 20));
        assert_eq!(px(clipped.to), (110, 110));
    }

    #[test]
    fn a_segment_that_misses_the_page_entirely_is_nothing() {
        assert_eq!(
            clip_segment_to_area(&AREA, pt(-50.0, -50.0), pt(-10.0, 300.0)),
            None
        );
        assert_eq!(
            clip_segment_to_area(&AREA, pt(200.0, 0.0), pt(300.0, 400.0)),
            None
        );
        // Parallel to an edge and outside it.
        assert_eq!(
            clip_segment_to_area(&AREA, pt(5.0, 30.0), pt(5.0, 200.0)),
            None
        );
    }

    #[test]
    fn a_segment_along_an_edge_is_on_the_page_not_off_it() {
        let clipped = clip_segment_to_area(&AREA, pt(10.0, 0.0), pt(10.0, 300.0)).unwrap();
        assert_eq!(clipped.from, pt(10.0, 20.0));
        assert_eq!(clipped.to.y.round() as i64, 220);
        assert_eq!(clipped.to.x, 10.0);
    }
}
