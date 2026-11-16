//! The candidate pick of the stroke index: which of the strokes an R-tree search
//! returned are alive and really meet the query box. A port of the filter in
//! `InkStrokeIndex.nearBox` (`apps/web/src/features/ink/application/stroke-index.ts`).
//!
//! The R-tree itself stays in TypeScript (`flatbush`, see that file). The caller
//! hands over the leaves' stroke indices with their liveness and boxes, so this
//! function does no allocation beyond its output and no lookups of its own.

use super::page_buffer::{Bounds, bounds_intersect};

/// Keeps the candidates alive and within `query` (grown by `slack`), in input order.
///
/// `indices[i]` is a stroke index, `alive[i]` whether it is live, and
/// `bounds[4 * i..4 * i + 4]` its box. Unequal lengths keep only the aligned
/// prefix, so a short array never reads past its end.
#[must_use]
pub fn pick_candidates(
    indices: &[u32],
    alive: &[bool],
    bounds: &[f64],
    query: Bounds,
    slack: f64,
) -> Vec<u32> {
    let count = indices.len().min(alive.len()).min(bounds.len() / 4);
    let mut kept = Vec::new();
    for i in 0..count {
        if !alive[i] {
            continue;
        }
        let stroke = [
            bounds[i * 4],
            bounds[i * 4 + 1],
            bounds[i * 4 + 2],
            bounds[i * 4 + 3],
        ];
        if bounds_intersect(stroke, query, slack) {
            kept.push(indices[i]);
        }
    }
    kept
}

#[cfg(test)]
mod tests {
    use super::pick_candidates;

    #[test]
    fn a_dead_stroke_is_never_picked() {
        let picked = pick_candidates(
            &[7],
            &[false],
            &[0.0, 0.0, 10.0, 10.0],
            [0.0, 0.0, 10.0, 10.0],
            0.0,
        );
        assert!(picked.is_empty());
    }

    #[test]
    fn only_strokes_meeting_the_box_are_kept_in_order() {
        let indices = [1, 2, 3];
        let alive = [true, true, true];
        let bounds = [
            0.0, 0.0, 5.0, 5.0, 100.0, 100.0, 110.0, 110.0, 4.0, 4.0, 9.0, 9.0,
        ];
        let picked = pick_candidates(&indices, &alive, &bounds, [0.0, 0.0, 6.0, 6.0], 0.0);
        assert_eq!(picked, vec![1, 3]);
    }

    #[test]
    fn slack_grows_the_query_box() {
        let picked = pick_candidates(
            &[5],
            &[true],
            &[12.0, 0.0, 14.0, 2.0],
            [0.0, 0.0, 10.0, 10.0],
            2.0,
        );
        assert_eq!(picked, vec![5]);
    }

    #[test]
    fn mismatched_lengths_keep_the_aligned_prefix() {
        let picked = pick_candidates(
            &[1, 2],
            &[true],
            &[0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0],
            [0.0, 0.0, 1.0, 1.0],
            0.0,
        );
        assert_eq!(picked, vec![1]);
    }
}
