//! The state of one erase sweep, down to up: which pointer sweeps, whether the
//! pen's back tip made it, and which pointer keeps the eraser cursor after a
//! back-tip lift. A port of `EraserSweep` in
//! `apps/web/src/features/ink/application/eraser-tip.ts`.
//!
//! The state machine lives here. The cursor itself does not: it is a DOM style on
//! a surface the caller holds, so each method returns a [`CursorAction`] and the
//! caller applies it to the element it tracks.

/// What the caller does to the eraser cursor after a transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorAction {
    /// Nothing changed; the caller's answer to "not handled" too.
    None,
    /// Restore the surface it shows now, then show the eraser on the new one.
    Show,
    /// The sweep ends with the eraser still shown; nothing to do yet.
    Keep,
    /// Restore the surface it shows now to its own cursor.
    Restore,
}

/// The sweep's state. `pointer` is the pointer id sweeping, if any; `sticky` is
/// the pointer whose hover still shows the eraser after a back-tip lift.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct EraserSweepState {
    pointer: Option<i64>,
    by_tip: bool,
    sticky: Option<i64>,
}

impl EraserSweepState {
    /// Starts a sweep when the armed tool erases, or when `tip_erases` and the
    /// pen's back tip made the contact (`pen_eraser`). `None` leaves the down to
    /// the caller.
    pub fn begin(
        &mut self,
        pointer: i64,
        tool_erases: bool,
        tip_erases: bool,
        pen_eraser: bool,
    ) -> CursorAction {
        let by_tip = tip_erases && pen_eraser;
        if !tool_erases && !by_tip {
            return CursorAction::None;
        }
        self.sticky = None;
        self.pointer = Some(pointer);
        self.by_tip = by_tip;
        CursorAction::Show
    }

    /// Whether `pointer` is the one sweeping.
    #[must_use]
    pub fn owns(&self, pointer: i64) -> bool {
        self.pointer == Some(pointer)
    }

    /// Ends the sweep `pointer` owns. `None` when it owned none.
    pub fn end(&mut self, pointer: i64) -> CursorAction {
        if self.pointer != Some(pointer) {
            return CursorAction::None;
        }
        self.pointer = None;
        if self.by_tip {
            self.sticky = Some(pointer);
            CursorAction::Keep
        } else {
            CursorAction::Restore
        }
    }

    /// A hover: `Show` when `pointer` is the sticky one, so the caller re-shows the
    /// eraser on the surface under it (it skips a surface already shown).
    pub fn hover(&self, pointer: i64) -> CursorAction {
        if self.sticky == Some(pointer) {
            CursorAction::Show
        } else {
            CursorAction::None
        }
    }

    /// The pointer left the surface: `Restore` when it is sticky and no sweep runs.
    pub fn leave(&self, pointer: i64) -> CursorAction {
        if self.sticky == Some(pointer) && self.pointer.is_none() {
            CursorAction::Restore
        } else {
            CursorAction::None
        }
    }

    /// A down that did not erase: the sticky cursor ends with it.
    pub fn release(&mut self, pointer: i64) -> CursorAction {
        if self.sticky != Some(pointer) {
            return CursorAction::None;
        }
        self.sticky = None;
        CursorAction::Restore
    }
}

#[cfg(test)]
mod tests {
    use super::{CursorAction, EraserSweepState};

    #[test]
    fn a_down_that_erases_nothing_is_left_to_the_caller() {
        let mut sweep = EraserSweepState::default();
        assert_eq!(sweep.begin(1, false, true, false), CursorAction::None);
        assert!(!sweep.owns(1));
    }

    #[test]
    fn the_tool_or_the_back_tip_starts_a_sweep() {
        let mut sweep = EraserSweepState::default();
        assert_eq!(sweep.begin(1, true, false, false), CursorAction::Show);
        assert!(sweep.owns(1));
        assert_eq!(sweep.end(1), CursorAction::Restore);
        assert_eq!(sweep.begin(2, false, true, true), CursorAction::Show);
        assert_eq!(sweep.end(2), CursorAction::Keep);
    }

    #[test]
    fn only_the_sweeping_pointer_ends_it() {
        let mut sweep = EraserSweepState::default();
        let _ = sweep.begin(1, true, false, false);
        assert_eq!(sweep.end(9), CursorAction::None);
        assert!(sweep.owns(1));
    }

    #[test]
    fn a_back_tip_lift_keeps_the_cursor_for_the_hovering_pointer() {
        let mut sweep = EraserSweepState::default();
        let _ = sweep.begin(3, false, true, true);
        let _ = sweep.end(3);
        assert_eq!(sweep.hover(3), CursorAction::Show);
        assert_eq!(sweep.hover(4), CursorAction::None);
        assert_eq!(sweep.leave(3), CursorAction::Restore);
    }

    #[test]
    fn a_new_sweep_or_a_front_tip_down_ends_the_sticky_cursor() {
        let mut sweep = EraserSweepState::default();
        let _ = sweep.begin(3, false, true, true);
        let _ = sweep.end(3);
        assert_eq!(sweep.release(3), CursorAction::Restore);
        assert_eq!(sweep.hover(3), CursorAction::None);

        let _ = sweep.begin(3, false, true, true);
        let _ = sweep.end(3);
        assert_eq!(sweep.begin(5, true, false, false), CursorAction::Show);
        assert_eq!(sweep.hover(3), CursorAction::None);
    }

    #[test]
    fn leave_does_not_restore_while_a_sweep_runs() {
        let mut sweep = EraserSweepState::default();
        let _ = sweep.begin(3, false, true, true);
        let _ = sweep.end(3);
        let _ = sweep.begin(3, false, true, true);
        assert_eq!(sweep.leave(3), CursorAction::None);
    }
}
