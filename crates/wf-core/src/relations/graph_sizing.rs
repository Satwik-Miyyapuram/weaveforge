//! Node and label sizes for the graph view at a zoom, in graph units. A port of
//! `apps/web/src/features/relations/ui/graph-sizing.ts`. Every stroke is a fraction of the drawn
//! size, so an outline never outgrows its node however far in the camera goes.

use serde::{Deserialize, Serialize};

/// Outline width as a fraction of an unbounded node's radius.
const LINE: f64 = 0.14;
/// Stamp drop-shadow offset as a fraction of an unbounded node's radius.
const DROP: f64 = 0.22;
/// Label outline as a fraction of an unbounded label's font size.
const LABEL_LINE: f64 = 0.1;
/// Smallest pointer radius on screen, in pixels.
const MIN_HIT_PX: f64 = 7.0;

/// How big a node draws at a zoom.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct NodeSize {
    /// Radius.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub r: f64,
    /// Outline width.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub line: f64,
    /// The stamp's offset shadow.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub drop: f64,
    /// Pointer radius: the drawn shape plus its outline, never under 7px on screen.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub hit: f64,
}

/// How big a node's label draws at a zoom.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LabelSize {
    /// Font size.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub font: f64,
    /// The stamp tag's border.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub line: f64,
    /// Space between the node and its label.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub gap: f64,
}

/// Lower bound of `v` at `lo`, then upper bound at `hi` (the JS `Math.min(hi, Math.max(lo, v))`).
fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}

/// The node size for a base radius at `zoom`. A bounded node grows with the zoom but is capped;
/// an unbounded one keeps its base radius in graph units.
#[must_use]
pub fn node_size(base_r: f64, zoom: f64, bounded: bool) -> NodeSize {
    let z = zoom.max(0.01);
    if bounded {
        let big = 5.0_f64.max(base_r * clamp(z.powf(0.45), 0.6, 3.2));
        let r = big / z;
        let line = (big * 0.13).max(1.2) / z;
        return NodeSize {
            r,
            line,
            drop: (big * 0.18).max(1.5) / z,
            hit: (r + line).max(MIN_HIT_PX / z),
        };
    }
    let line = base_r * LINE;
    NodeSize {
        r: base_r,
        line,
        drop: base_r * DROP,
        hit: (base_r + line).max(MIN_HIT_PX / z),
    }
}

/// The label size at `zoom`. `is_tag` picks the tag label's (slightly smaller) base size.
#[must_use]
pub fn label_size(is_tag: bool, zoom: f64, bounded: bool) -> LabelSize {
    let z = zoom.max(0.01);
    let screen = if is_tag { 10.0 } else { 10.5 };
    if bounded {
        let font = screen * clamp(z.powf(0.35), 0.85, 2.2) / z;
        return LabelSize {
            font,
            line: (font * z * 0.09).max(1.0) / z,
            gap: 2.0 / z,
        };
    }
    let min_font: f64 = if is_tag { 4.0 } else { 4.5 };
    let font = min_font.max(screen / z);
    LabelSize {
        font,
        line: font * LABEL_LINE,
        gap: font * 0.2,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn bounded_node_at_unit_zoom() {
        let n = node_size(10.0, 1.0, true);
        assert!(close(n.r, 10.0));
        assert!(close(n.line, 1.3));
        assert!(close(n.drop, 1.8));
        assert!(close(n.hit, 11.3));
    }

    #[test]
    fn unbounded_node_keeps_base_radius() {
        let n = node_size(10.0, 1.0, false);
        assert!(close(n.r, 10.0));
        assert!(close(n.line, 1.4));
        assert!(close(n.drop, 2.2));
        assert!(close(n.hit, 11.4));
    }

    #[test]
    fn hit_radius_has_screen_minimum() {
        // At zoom 0.1 a 1-unit node is 0.1 px across; the pointer still reaches 7px.
        let n = node_size(1.0, 0.1, false);
        assert!(close(n.hit, 7.0 / 0.1));
    }

    #[test]
    fn bounded_label_uses_tag_base_size() {
        let tag = label_size(true, 1.0, true);
        assert!(close(tag.font, 10.0));
        assert!(close(tag.line, 1.0));
        assert!(close(tag.gap, 2.0));
        let paper = label_size(false, 1.0, true);
        assert!(close(paper.font, 10.5));
    }

    #[test]
    fn unbounded_label_has_minimum_font() {
        let l = label_size(false, 100.0, false);
        assert!(close(l.font, 4.5));
        assert!(close(l.line, 0.45));
        assert!(close(l.gap, 0.9));
    }
}
