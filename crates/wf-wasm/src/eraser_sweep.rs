//! The erase sweep's state for JavaScript (wf-core `ink::eraser_sweep`). Each
//! transition returns the cursor action as a string: `"none"`, `"show"`, `"keep"`
//! or `"restore"`. The DOM surface and its saved cursor stay in
//! `apps/web/src/features/ink/application/parts-1.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::eraser_sweep::{CursorAction, EraserSweepState as Core};

fn action_name(action: CursorAction) -> &'static str {
    match action {
        CursorAction::None => "none",
        CursorAction::Show => "show",
        CursorAction::Keep => "keep",
        CursorAction::Restore => "restore",
    }
}

/// [`EraserSweepState`](Core): one erase sweep. Pointer ids are the DOM `pointerId`s.
#[wasm_bindgen]
pub struct EraserSweepState {
    inner: Core,
}

#[wasm_bindgen]
// DOM `pointerId`s are small whole numbers, so the casts to i64 are exact.
#[allow(clippy::cast_possible_truncation)]
impl EraserSweepState {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> EraserSweepState {
        EraserSweepState {
            inner: Core::default(),
        }
    }

    /// Starts a sweep; `pen_eraser` is whether the pointer is the pen's eraser end.
    pub fn begin(
        &mut self,
        pointer_id: f64,
        tool_erases: bool,
        tip_erases: bool,
        pen_eraser: bool,
    ) -> String {
        action_name(
            self.inner
                .begin(pointer_id as i64, tool_erases, tip_erases, pen_eraser),
        )
        .to_string()
    }

    /// Whether `pointer_id` is the one sweeping.
    #[must_use]
    pub fn owns(&self, pointer_id: f64) -> bool {
        self.inner.owns(pointer_id as i64)
    }

    /// Ends the sweep `pointer_id` owns.
    pub fn end(&mut self, pointer_id: f64) -> String {
        action_name(self.inner.end(pointer_id as i64)).to_string()
    }

    /// A hover by `pointer_id`.
    #[must_use]
    pub fn hover(&self, pointer_id: f64) -> String {
        action_name(self.inner.hover(pointer_id as i64)).to_string()
    }

    /// The pointer `pointer_id` left the surface.
    #[must_use]
    pub fn leave(&self, pointer_id: f64) -> String {
        action_name(self.inner.leave(pointer_id as i64)).to_string()
    }

    /// A down by `pointer_id` that did not erase.
    pub fn release(&mut self, pointer_id: f64) -> String {
        action_name(self.inner.release(pointer_id as i64)).to_string()
    }
}

impl Default for EraserSweepState {
    fn default() -> Self {
        Self::new()
    }
}
