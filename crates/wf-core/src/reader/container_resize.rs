//! Scroll-container resize decision (`reader::container_resize`). Port of
//! `containerResize` in `apps/web/src/features/reader/ui/pdf-reader/container-resize.ts`.
//!
//! A background editor tab is `display:none` and reads 0 wide; fitting to that
//! would shrink the page to the smallest zoom, so the last fit is kept and
//! refitted at once when the tab is shown again. Any other resize is usually an
//! animation and waits for the size to settle.

use serde::{Deserialize, Serialize};

/// A measured box, in CSS pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct BoxSize {
    /// Width.
    pub width: f64,
    /// Height.
    pub height: f64,
}

/// What to do on a resize: `"ignore"`, `"now"` (refit at once) or `"settle"` (wait).
#[must_use]
pub fn container_resize(last: BoxSize, next: BoxSize) -> &'static str {
    if next.width == last.width && next.height == last.height {
        return "ignore";
    }
    if next.width == 0.0 {
        return "ignore";
    }
    if last.width == 0.0 { "now" } else { "settle" }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn size(width: f64, height: f64) -> BoxSize {
        BoxSize { width, height }
    }

    #[test]
    fn hidden_container_is_not_measured() {
        assert_eq!(
            container_resize(size(800.0, 600.0), size(0.0, 0.0)),
            "ignore"
        );
        assert_eq!(
            container_resize(size(800.0, 600.0), size(0.0, 600.0)),
            "ignore"
        );
    }

    #[test]
    fn container_shown_again_is_measured_at_once() {
        assert_eq!(container_resize(size(0.0, 0.0), size(762.0, 900.0)), "now");
    }

    #[test]
    fn resize_of_visible_container_waits_to_settle() {
        assert_eq!(
            container_resize(size(800.0, 600.0), size(762.0, 600.0)),
            "settle"
        );
        assert_eq!(
            container_resize(size(800.0, 600.0), size(800.0, 500.0)),
            "settle"
        );
    }

    #[test]
    fn unchanged_size_does_nothing() {
        assert_eq!(
            container_resize(size(800.0, 600.0), size(800.0, 600.0)),
            "ignore"
        );
        assert_eq!(container_resize(size(0.0, 0.0), size(0.0, 0.0)), "ignore");
    }
}
