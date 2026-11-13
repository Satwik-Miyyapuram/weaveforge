//! Which text run a press beside the words was aimed at. A port of
//! `apps/web/src/features/reader/ui/pdf-reader/text-snap.ts` (`snapToText`).
//!
//! The text layer's runs are separate boxes with bare page between them. A press a few
//! pixels left of a line, past its end or between two lines lands on no text, so this
//! picks the nearest run, favouring the press's own line, and a point just inside it.

use serde::{Deserialize, Serialize};

/// Largest horizontal distance, in pixels, at which a press still snaps to a run.
const MAX_DX: f64 = 120.0;
/// Largest vertical distance, in pixels, at which a press still snaps to a run.
const MAX_DY: f64 = 24.0;
/// Vertical distance counts more, so a press keeps to its own line.
const LINE_WEIGHT: f64 = 4.0;

/// A text run's box in screen pixels, as `getBoundingClientRect()` reports it.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TextRunBox {
    /// Left edge.
    pub left: f64,
    /// Top edge.
    pub top: f64,
    /// Right edge.
    pub right: f64,
    /// Bottom edge.
    pub bottom: f64,
}

/// Where a press snaps: the run it landed on, and the point inside it for the caret.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SnapHit {
    /// Index of the chosen run in the input slice.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub index: usize,
    /// Horizontal caret position, kept half a pixel inside the run.
    pub x: f64,
    /// Vertical caret position: the press's own `y` when it is inside the run, else the middle.
    pub y: f64,
}

/// The run nearest a press, or `None` when no non-empty run is within reach.
///
/// Runs with no area are skipped. Among the rest the lowest score `dy * 4 + dx` wins, and
/// the first run keeps a tie.
#[must_use]
pub fn snap_to_text(runs: &[TextRunBox], x: f64, y: f64) -> Option<SnapHit> {
    let mut index: Option<usize> = None;
    let mut best_score = f64::INFINITY;
    for (i, run) in runs.iter().enumerate() {
        if run.right <= run.left || run.bottom <= run.top {
            continue;
        }
        let dx = (run.left - x).max(0.0).max(x - run.right);
        let dy = (run.top - y).max(0.0).max(y - run.bottom);
        if dx > MAX_DX || dy > MAX_DY {
            continue;
        }
        let score = dy * LINE_WEIGHT + dx;
        if score < best_score {
            best_score = score;
            index = Some(i);
        }
    }
    let i = index?;
    let run = runs[i];
    Some(SnapHit {
        index: i,
        x: x.max(run.left + 0.5).min(run.right - 0.5),
        y: if y >= run.top && y <= run.bottom {
            y
        } else {
            (run.top + run.bottom) / 2.0
        },
    })
}

// No TS test on main for this module; cases come from the doc comments.
#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use super::*;

    fn run(left: f64, top: f64, right: f64, bottom: f64) -> TextRunBox {
        TextRunBox {
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn no_runs_snaps_to_nothing() {
        assert_eq!(snap_to_text(&[], 0.0, 0.0).map(|h| h.index), None);
    }

    #[test]
    fn a_run_with_no_area_is_skipped() {
        let runs = [run(10.0, 10.0, 10.0, 20.0)];
        assert_eq!(snap_to_text(&runs, 10.0, 15.0).map(|h| h.index), None);
    }

    #[test]
    fn a_press_beyond_reach_snaps_to_nothing() {
        // 400 px past the run's right edge, beyond the 120 px horizontal reach.
        let runs = [run(0.0, 0.0, 100.0, 10.0)];
        assert_eq!(snap_to_text(&runs, 500.0, 5.0).map(|h| h.index), None);
    }

    #[test]
    fn the_press_keeps_to_its_own_line() {
        // Run 1 is 2 px above the press; run 0 is 18 px above it. Vertical distance weighs 4x.
        let runs = [run(0.0, 0.0, 100.0, 10.0), run(0.0, 30.0, 100.0, 40.0)];
        assert_eq!(snap_to_text(&runs, 50.0, 28.0).map(|h| h.index), Some(1));
    }

    #[test]
    fn a_tie_keeps_the_first_run() {
        let runs = [run(0.0, 0.0, 100.0, 10.0), run(0.0, 0.0, 100.0, 10.0)];
        assert_eq!(snap_to_text(&runs, 50.0, 5.0).map(|h| h.index), Some(0));
    }

    #[test]
    fn the_caret_is_kept_half_a_pixel_inside_the_run() {
        let runs = [run(0.0, 0.0, 100.0, 10.0)];
        let hit = snap_to_text(&runs, -5.0, 5.0);
        assert_eq!(hit.as_ref().map(|h| h.x), Some(0.5));
        assert_eq!(hit.map(|h| h.y), Some(5.0));
    }
}
