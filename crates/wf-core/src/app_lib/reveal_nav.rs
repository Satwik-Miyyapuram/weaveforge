//! Sidebar reveal geometry (`apps/web/src/app/reveal-active-nav.ts`).
//!
//! The DOM reads the row and the scroller rectangles and writes `scrollTop`; this module only
//! decides the new `scrollTop` from those numbers.

/// A vertical span: a row, or the visible part of a scroller.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Span {
    pub top: f64,
    pub bottom: f64,
}

/// The `scrollTop` that shows `row` whole inside `view`, moving as little as possible.
#[must_use]
pub fn scroll_top_to_reveal(row: Span, view: Span, scroll_top: f64) -> f64 {
    if row.top < view.top {
        return scroll_top - (view.top - row.top);
    }
    if row.bottom > view.bottom {
        return scroll_top + (row.bottom - view.bottom);
    }
    scroll_top
}

#[cfg(test)]
mod tests {
    use super::*;

    const VIEW: Span = Span {
        top: 120.0,
        bottom: 750.0,
    };

    #[test]
    // it: "a row already in view does not move the column"
    fn row_in_view_keeps_scroll() {
        assert_eq!(
            scroll_top_to_reveal(
                Span {
                    top: 200.0,
                    bottom: 244.0
                },
                VIEW,
                0.0
            ),
            0.0
        );
        assert_eq!(
            scroll_top_to_reveal(
                Span {
                    top: 120.0,
                    bottom: 750.0
                },
                VIEW,
                40.0
            ),
            40.0
        );
    }

    #[test]
    // it: "a row below the fold scrolls up just enough to show it whole"
    fn row_below_fold_scrolls_down_minimally() {
        assert_eq!(
            scroll_top_to_reveal(
                Span {
                    top: 740.0,
                    bottom: 784.0
                },
                VIEW,
                0.0
            ),
            34.0
        );
        assert_eq!(
            scroll_top_to_reveal(
                Span {
                    top: 900.0,
                    bottom: 944.0
                },
                VIEW,
                10.0
            ),
            204.0
        );
    }

    #[test]
    // it: "a row above the fold scrolls down to its top"
    fn row_above_fold_scrolls_up_to_its_top() {
        assert_eq!(
            scroll_top_to_reveal(
                Span {
                    top: 80.0,
                    bottom: 124.0
                },
                VIEW,
                100.0
            ),
            60.0
        );
    }
}
