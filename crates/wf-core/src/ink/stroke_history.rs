//! The worker's stroke undo log: which step is recorded, and which action an
//! undo or redo asks the page to take.
//!
//! A port of the step stacks in `apps/web/src/features/ink/worker/ink-page-logic.ts`.
//! The stacks only decide; the buffer and renderer are the caller's, so each
//! action comes back for the caller to apply.

use serde::{Deserialize, Serialize};

/// One undoable stroke step. `indices` are buffer indices; a move also carries its delta.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum HistoryStep {
    /// Strokes taken out by an erase, or by a delete.
    Erase { indices: Vec<usize> },
    /// Strokes added by a draw.
    Draw { indices: Vec<usize> },
    /// Strokes translated by (`dx`, `dy`).
    Move {
        indices: Vec<usize>,
        dx: f64,
        dy: f64,
    },
}

/// The two stacks: `history` is what undo pops, `redone` what redo pops.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct StrokeHistory {
    /// Steps that undo can take back, oldest first.
    #[serde(default)]
    pub history: Vec<HistoryStep>,
    /// Steps that were undone and that redo can replay.
    #[serde(default)]
    pub redone: Vec<HistoryStep>,
}

/// What the page must do to the strokes for an undo or redo to take effect.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum StrokeAction {
    /// Bring erased strokes back, each at its own index.
    Restore { indices: Vec<usize> },
    /// Take strokes out, without recording a new step.
    Erase { indices: Vec<usize> },
    /// Shift strokes by (`dx`, `dy`).
    Translate { indices: Vec<usize>, dx: f64, dy: f64 },
}

/// One request to the log: record a new step, or undo or redo the last one.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum StrokeHistoryOp {
    /// A fresh edit. Clears the redo stack, as every new edit does.
    Record { step: HistoryStep },
    /// Undo the last step.
    Undo,
    /// Redo the last undone step.
    Redo,
}

/// The stacks after the request, and the action to apply (none when there was nothing to undo or redo).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StrokeHistoryOutcome {
    pub stacks: StrokeHistory,
    pub action: Option<StrokeAction>,
}

/// Apply one request to the stacks.
pub fn stroke_history_step(mut stacks: StrokeHistory, op: StrokeHistoryOp) -> StrokeHistoryOutcome {
    let action = match op {
        StrokeHistoryOp::Record { step } => {
            record(&mut stacks, step);
            None
        }
        StrokeHistoryOp::Undo => take_undo(&mut stacks),
        StrokeHistoryOp::Redo => take_redo(&mut stacks),
    };
    StrokeHistoryOutcome { stacks, action }
}

/// Push a fresh step and clear redo. An erase that removed nothing is not a step.
fn record(stacks: &mut StrokeHistory, step: HistoryStep) {
    if let HistoryStep::Erase { indices } = &step {
        if indices.is_empty() {
            return;
        }
    }
    stacks.history.push(step);
    stacks.redone.clear();
}

/// Undo: the erase comes back, a draw goes, a move slides back by its delta.
fn take_undo(stacks: &mut StrokeHistory) -> Option<StrokeAction> {
    let step = stacks.history.pop()?;
    let action = match &step {
        HistoryStep::Erase { indices } => StrokeAction::Restore {
            indices: indices.clone(),
        },
        HistoryStep::Draw { indices } => StrokeAction::Erase {
            indices: indices.clone(),
        },
        HistoryStep::Move { indices, dx, dy } => StrokeAction::Translate {
            indices: indices.clone(),
            dx: -dx,
            dy: -dy,
        },
    };
    stacks.redone.push(step);
    Some(action)
}

/// Redo: the erase is taken out again, a draw comes back, a move slides forward.
fn take_redo(stacks: &mut StrokeHistory) -> Option<StrokeAction> {
    let step = stacks.redone.pop()?;
    let action = match &step {
        HistoryStep::Erase { indices } => StrokeAction::Erase {
            indices: indices.clone(),
        },
        HistoryStep::Draw { indices } => StrokeAction::Restore {
            indices: indices.clone(),
        },
        HistoryStep::Move { indices, dx, dy } => StrokeAction::Translate {
            indices: indices.clone(),
            dx: *dx,
            dy: *dy,
        },
    };
    stacks.history.push(step);
    Some(action)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn erase(indices: &[usize]) -> HistoryStep {
        HistoryStep::Erase {
            indices: indices.to_vec(),
        }
    }

    #[test]
    fn empty_erase_records_nothing() {
        let out = stroke_history_step(
            StrokeHistory::default(),
            StrokeHistoryOp::Record { step: erase(&[]) },
        );
        assert_eq!(out.stacks, StrokeHistory::default());
        assert_eq!(out.action, None);
    }

    #[test]
    fn record_clears_redo() {
        let mut stacks = StrokeHistory::default();
        stacks.redone.push(erase(&[1]));
        let out = stroke_history_step(
            stacks,
            StrokeHistoryOp::Record { step: erase(&[2]) },
        );
        assert_eq!(out.stacks.history, vec![erase(&[2])]);
        assert!(out.stacks.redone.is_empty());
    }

    #[test]
    fn undo_of_empty_stack_does_nothing() {
        let out = stroke_history_step(StrokeHistory::default(), StrokeHistoryOp::Undo);
        assert_eq!(out.stacks, StrokeHistory::default());
        assert_eq!(out.action, None);
        let out = stroke_history_step(StrokeHistory::default(), StrokeHistoryOp::Redo);
        assert_eq!(out.action, None);
    }

    #[test]
    fn undo_erase_restores_and_redo_erases_again() {
        let stacks = StrokeHistory {
            history: vec![erase(&[3, 4])],
            redone: Vec::new(),
        };
        let undone = stroke_history_step(stacks, StrokeHistoryOp::Undo);
        assert_eq!(
            undone.action,
            Some(StrokeAction::Restore {
                indices: vec![3, 4]
            })
        );
        assert_eq!(undone.stacks.redone, vec![erase(&[3, 4])]);
        let redone = stroke_history_step(undone.stacks, StrokeHistoryOp::Redo);
        assert_eq!(
            redone.action,
            Some(StrokeAction::Erase {
                indices: vec![3, 4]
            })
        );
        assert_eq!(redone.stacks.history, vec![erase(&[3, 4])]);
    }

    #[test]
    fn undo_draw_erases_and_redo_restores() {
        let stacks = StrokeHistory {
            history: vec![HistoryStep::Draw { indices: vec![7] }],
            redone: Vec::new(),
        };
        let undone = stroke_history_step(stacks, StrokeHistoryOp::Undo);
        assert_eq!(undone.action, Some(StrokeAction::Erase { indices: vec![7] }));
        let redone = stroke_history_step(undone.stacks, StrokeHistoryOp::Redo);
        assert_eq!(
            redone.action,
            Some(StrokeAction::Restore { indices: vec![7] })
        );
    }

    #[test]
    fn undo_move_slides_back_and_redo_slides_forward() {
        let stacks = StrokeHistory {
            history: vec![HistoryStep::Move {
                indices: vec![0],
                dx: 2.5,
                dy: -4.0,
            }],
            redone: Vec::new(),
        };
        let undone = stroke_history_step(stacks, StrokeHistoryOp::Undo);
        assert_eq!(
            undone.action,
            Some(StrokeAction::Translate {
                indices: vec![0],
                dx: -2.5,
                dy: 4.0
            })
        );
        let redone = stroke_history_step(undone.stacks, StrokeHistoryOp::Redo);
        assert_eq!(
            redone.action,
            Some(StrokeAction::Translate {
                indices: vec![0],
                dx: 2.5,
                dy: -4.0
            })
        );
    }

    #[test]
    fn a_new_edit_after_undo_drops_the_redo_stack() {
        let stacks = StrokeHistory {
            history: vec![erase(&[1])],
            redone: Vec::new(),
        };
        let undone = stroke_history_step(stacks, StrokeHistoryOp::Undo);
        let recorded = stroke_history_step(
            undone.stacks,
            StrokeHistoryOp::Record {
                step: HistoryStep::Draw { indices: vec![9] },
            },
        );
        assert!(recorded.stacks.redone.is_empty());
        assert_eq!(recorded.stacks.history.len(), 1);
    }
}
