//! Rectangles on a canvas: a node's box, the box around all nodes (fit to view), and which
//! nodes a group holds (they move with it).

use serde::Serialize;

use super::{Canvas, CanvasNode};

/// An axis-aligned box in canvas pixels; `y` grows downwards.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CanvasRect {
    /// Left edge.
    pub x: f64,
    /// Top edge.
    pub y: f64,
    /// Width, never negative.
    pub width: f64,
    /// Height, never negative.
    pub height: f64,
}

impl CanvasRect {
    fn right(&self) -> f64 {
        self.x + self.width
    }

    fn bottom(&self) -> f64 {
        self.y + self.height
    }

    /// Whether `other` lies wholly inside this box (edges may touch).
    #[must_use]
    pub fn contains(&self, other: &Self) -> bool {
        other.x >= self.x
            && other.y >= self.y
            && other.right() <= self.right()
            && other.bottom() <= self.bottom()
    }
}

/// A node's box. A negative or missing size counts as zero.
#[must_use]
pub fn node_rect(node: &CanvasNode) -> CanvasRect {
    CanvasRect {
        x: node.x,
        y: node.y,
        width: node.width.max(0.0),
        height: node.height.max(0.0),
    }
}

/// The smallest box around every node, or `None` for an empty canvas: what "fit to view" shows.
/// A node with no position (NaN) has no place to show, so it is left out.
#[must_use]
pub fn canvas_bounds(canvas: &Canvas) -> Option<CanvasRect> {
    let mut rects = canvas.nodes.iter().map(node_rect).filter(|r| {
        r.x.is_finite() && r.y.is_finite() && r.width.is_finite() && r.height.is_finite()
    });
    let first = rects.next()?;
    let (mut left, mut top, mut right, mut bottom) =
        (first.x, first.y, first.right(), first.bottom());
    for r in rects {
        left = left.min(r.x);
        top = top.min(r.y);
        right = right.max(r.right());
        bottom = bottom.max(r.bottom());
    }
    Some(CanvasRect {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    })
}

/// Ids of the nodes wholly inside group `group_id`, in z-order; empty when there is no such
/// group. This is how Obsidian decides what a group drags along: by position, not by a stored
/// parent, so the file needs no extra field.
#[must_use]
pub fn group_members(canvas: &Canvas, group_id: &str) -> Vec<String> {
    let Some(group) = canvas
        .nodes
        .iter()
        .find(|n| n.id == group_id && n.kind == "group")
    else {
        return Vec::new();
    };
    let area = node_rect(group);
    canvas
        .nodes
        .iter()
        .filter(|n| n.id != group_id && area.contains(&node_rect(n)))
        .map(|n| n.id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, kind: &str, x: f64, y: f64, w: f64, h: f64) -> CanvasNode {
        CanvasNode {
            id: id.into(),
            kind: kind.into(),
            x,
            y,
            width: w,
            height: h,
            ..CanvasNode::default()
        }
    }

    fn canvas(nodes: Vec<CanvasNode>) -> Canvas {
        Canvas {
            nodes,
            ..Canvas::default()
        }
    }

    #[test]
    fn bounds_of_an_empty_canvas_is_none() {
        assert_eq!(canvas_bounds(&Canvas::default()), None);
    }

    #[test]
    fn bounds_leave_out_a_node_with_no_position() {
        let c = canvas(vec![
            node("a", "text", f64::NAN, 0.0, 10.0, 10.0),
            node("b", "text", 5.0, 6.0, 20.0, 30.0),
            node("c", "text", 0.0, f64::NAN, 10.0, 10.0),
        ]);
        assert_eq!(
            canvas_bounds(&c),
            Some(CanvasRect {
                x: 5.0,
                y: 6.0,
                width: 20.0,
                height: 30.0
            })
        );
    }

    #[test]
    fn bounds_with_no_positioned_node_is_none() {
        let c = canvas(vec![node("a", "text", f64::NAN, f64::NAN, 10.0, 10.0)]);
        assert_eq!(canvas_bounds(&c), None);
    }

    #[test]
    fn bounds_cover_every_node_including_negative_positions() {
        let c = canvas(vec![
            node("a", "text", -100.0, 50.0, 20.0, 10.0),
            node("b", "text", 30.0, -40.0, 100.0, 300.0),
        ]);
        assert_eq!(
            canvas_bounds(&c),
            Some(CanvasRect {
                x: -100.0,
                y: -40.0,
                width: 230.0,
                height: 300.0
            })
        );
    }

    #[test]
    fn a_negative_size_counts_as_zero() {
        let r = node_rect(&node("a", "text", 5.0, 6.0, -10.0, 2.0));
        assert_eq!(
            r,
            CanvasRect {
                x: 5.0,
                y: 6.0,
                width: 0.0,
                height: 2.0
            }
        );
    }

    #[test]
    fn group_members_are_the_nodes_wholly_inside_it() {
        let c = canvas(vec![
            node("g", "group", 0.0, 0.0, 100.0, 100.0),
            node("in", "text", 10.0, 10.0, 20.0, 20.0),
            node("edge", "text", 0.0, 0.0, 100.0, 100.0),
            node("half", "text", 90.0, 90.0, 20.0, 20.0),
            node("out", "text", 200.0, 0.0, 10.0, 10.0),
        ]);
        assert_eq!(group_members(&c, "g"), vec!["in", "edge"]);
    }

    #[test]
    fn members_of_a_missing_or_non_group_node_are_none() {
        let c = canvas(vec![
            node("t", "text", 0.0, 0.0, 100.0, 100.0),
            node("in", "text", 10.0, 10.0, 1.0, 1.0),
        ]);
        assert!(group_members(&c, "t").is_empty());
        assert!(group_members(&c, "nope").is_empty());
    }

    #[test]
    fn nested_groups_carry_their_own_members_too() {
        let c = canvas(vec![
            node("outer", "group", 0.0, 0.0, 500.0, 500.0),
            node("inner", "group", 10.0, 10.0, 100.0, 100.0),
            node("leaf", "text", 20.0, 20.0, 10.0, 10.0),
        ]);
        assert_eq!(group_members(&c, "outer"), vec!["inner", "leaf"]);
        assert_eq!(group_members(&c, "inner"), vec!["leaf"]);
    }
}
