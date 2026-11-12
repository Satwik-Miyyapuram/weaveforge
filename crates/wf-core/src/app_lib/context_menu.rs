//! Right-click menu rules (`apps/web/src/components/context-menu-store.ts`).
//!
//! The TS store keeps the menu items and the listener set. This module decides whether an open
//! or close changes the state, and where a menu of a given size goes on screen. `VIEWPORT_PAD`
//! mirrors `apps/web/src/components/viewport-pad.ts`.

use serde::{Deserialize, Serialize};

/// Space every floating surface keeps from the viewport edge, in px.
pub const VIEWPORT_PAD: f64 = 12.0;

/// The pointer point a menu opened at.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// A state change request: open at a point with `count` items, or close.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Action {
    Open { x: f64, y: f64, count: usize },
    Close,
}

/// The next state, whether the open was accepted, and whether listeners must be notified.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Reduction {
    pub state: Option<Point>,
    pub accepted: bool,
    pub changed: bool,
}

/// Applies `action` to `state`. An open with no items is refused and the browser keeps its own
/// menu; a close changes nothing when no menu is open.
#[must_use]
pub fn reduce(state: Option<Point>, action: Action) -> Reduction {
    match action {
        Action::Open { x, y, count } if count > 0 => Reduction {
            state: Some(Point { x, y }),
            accepted: true,
            changed: true,
        },
        Action::Open { .. } => Reduction {
            state,
            accepted: false,
            changed: false,
        },
        Action::Close => Reduction {
            state: None,
            accepted: false,
            changed: state.is_some(),
        },
    }
}

/// Where a menu opened at (`x`, `y`) with size `width`×`height` goes on screen: flipped
/// left/up when it would overflow, then clamped to the pad.
#[must_use]
pub fn place(x: f64, y: f64, width: f64, height: f64, view_width: f64, view_height: f64) -> Point {
    let left = if x + width + VIEWPORT_PAD > view_width {
        x - width
    } else {
        x
    };
    let top = if y + height + VIEWPORT_PAD > view_height {
        y - height
    } else {
        y
    };
    Point {
        x: clamp(left, width, view_width),
        y: clamp(top, height, view_height),
    }
}

fn clamp(value: f64, size: f64, view: f64) -> f64 {
    value.min(view - size - VIEWPORT_PAD).max(VIEWPORT_PAD)
}

#[cfg(test)]
mod tests {
    use super::*;

    const OPEN_AT_5_7: Action = Action::Open {
        x: 5.0,
        y: 7.0,
        count: 1,
    };

    #[test]
    // it: "opening stores the point and items, stops the browser menu, and notifies"
    fn open_with_items_stores_point_and_notifies() {
        let opened = reduce(None, OPEN_AT_5_7);
        assert_eq!(opened.state, Some(Point { x: 5.0, y: 7.0 }));
        assert!(opened.accepted);
        assert!(opened.changed);
        let closed = reduce(opened.state, Action::Close);
        assert_eq!(closed.state, None);
        assert!(closed.changed);
    }

    #[test]
    // it: "no items keeps the browser's own menu"
    fn open_without_items_is_refused() {
        let refused = reduce(
            None,
            Action::Open {
                x: 1.0,
                y: 1.0,
                count: 0,
            },
        );
        assert_eq!(refused.state, None);
        assert!(!refused.accepted);
        assert!(!refused.changed);
    }

    #[test]
    // it: "closing when nothing is open does not notify"
    fn close_when_closed_does_not_change() {
        let closed = reduce(None, Action::Close);
        assert_eq!(closed.state, None);
        assert!(!closed.changed);
    }

    #[test]
    // it: "a menu that fits opens at the pointer"
    fn fitting_menu_opens_at_pointer() {
        assert_eq!(
            place(100.0, 100.0, 200.0, 300.0, 1000.0, 800.0),
            Point { x: 100.0, y: 100.0 }
        );
    }

    #[test]
    // it: "a menu near the right or bottom edge flips to the other side"
    fn menu_near_right_bottom_flips() {
        assert_eq!(
            place(900.0, 700.0, 200.0, 300.0, 1000.0, 800.0),
            Point { x: 700.0, y: 400.0 }
        );
    }

    #[test]
    // it: "a menu bigger than the room is clamped to the edge pad"
    fn oversized_menu_clamps_to_pad() {
        assert_eq!(
            place(50.0, 50.0, 200.0, 900.0, 1000.0, 800.0),
            Point { x: 50.0, y: 12.0 }
        );
    }
}
