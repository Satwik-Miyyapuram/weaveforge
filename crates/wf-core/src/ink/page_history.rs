//! One undo order for a page's strokes and its figures (design D18, DA-113).
//!
//! A port of `apps/web/src/features/ink/application/ink-page-history.ts`. The
//! worker keeps the stroke history and undoes strokes itself; figures live in
//! the text layer, on the main thread. This log only says whose turn each undo
//! is: a stroke step is handed to the worker, a figure step carries the page's
//! figures before and after and is put back by the host.

use serde::{Deserialize, Serialize};

use super::figure::FigurePlacement;

/// The stroke marker: serialises as the string `"stroke"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum StrokeStep {
    /// The only value: a stroke step, handed to the worker.
    Stroke,
}

/// A figure edit: the figures before and after, and the press that made it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FigureStep {
    /// The page's figures before the edit.
    pub before: Vec<FigurePlacement>,
    /// The page's figures after the edit.
    pub after: Vec<FigurePlacement>,
    /// The pointer press that made it; changes in one press are one step.
    pub key: Option<f64>,
}

/// One undoable step: a stroke, or a figure edit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(untagged)]
pub enum PageStep {
    /// A stroke, undone by the worker.
    Stroke(StrokeStep),
    /// A figure edit, put back by the host.
    Figure(FigureStep),
}

/// The undo and redo stacks for one page; the last entry is the next step.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PageHistory {
    /// Steps that can be undone, oldest first.
    pub undo: Vec<PageStep>,
    /// Steps that can be redone, oldest first.
    pub redo: Vec<PageStep>,
}

/// Which stack a step is taken from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum PageDirection {
    /// Take from the undo stack.
    Undo,
    /// Take from the redo stack.
    Redo,
}

/// A step taken off one stack, with the history after the move.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TakenPageStep {
    /// The history with the step moved to the other stack.
    pub history: PageHistory,
    /// The step that was taken.
    pub step: PageStep,
}

/// The history of a page with nothing to undo or redo.
#[must_use]
pub fn empty_page_history() -> PageHistory {
    PageHistory::default()
}

fn stroke_count(steps: &[PageStep]) -> usize {
    steps
        .iter()
        .filter(|step| matches!(step, PageStep::Stroke(_)))
        .count()
}

/// The worker reported how deep its stroke history is. Deeper than the log
/// knows means new strokes (a new branch, so redo is gone); shallower means the
/// worker forgot some (a page load), so the newest stroke steps go.
#[must_use]
pub fn sync_stroke_steps(history: &PageHistory, depth: usize) -> PageHistory {
    let known = stroke_count(&history.undo);
    if depth == known {
        return history.clone();
    }
    if depth > known {
        let mut undo = history.undo.clone();
        undo.extend(std::iter::repeat_n(
            PageStep::Stroke(StrokeStep::Stroke),
            depth - known,
        ));
        return PageHistory {
            undo,
            redo: Vec::new(),
        };
    }
    let mut drop = known - depth;
    let mut undo = history.undo.clone();
    let mut i = undo.len();
    while i > 0 && drop > 0 {
        i -= 1;
        if matches!(undo[i], PageStep::Stroke(_)) {
            let _ = undo.remove(i);
            drop -= 1;
        }
    }
    PageHistory {
        undo,
        redo: history.redo.clone(),
    }
}

/// The page's figures changed. A change in the same press as the last step
/// joins it; an unchanged pair of figure lists is no step at all.
#[must_use]
pub fn push_figure_step(
    history: &PageHistory,
    before: Vec<FigurePlacement>,
    after: Vec<FigurePlacement>,
    key: Option<f64>,
) -> PageHistory {
    if before == after {
        return history.clone();
    }
    if let (Some(press), Some(PageStep::Figure(last))) = (key, history.undo.last())
        && last.key == Some(press)
    {
        let mut undo = history.undo.clone();
        if let Some(PageStep::Figure(step)) = undo.last_mut() {
            step.after = after;
        }
        return PageHistory {
            undo,
            redo: Vec::new(),
        };
    }
    let mut undo = history.undo.clone();
    undo.push(PageStep::Figure(FigureStep { before, after, key }));
    PageHistory {
        undo,
        redo: Vec::new(),
    }
}

/// The step to undo or redo, moved to the other stack; `None` when there is none.
#[must_use]
pub fn take_page_step(history: &PageHistory, direction: PageDirection) -> Option<TakenPageStep> {
    let (from, to) = match direction {
        PageDirection::Undo => (&history.undo, &history.redo),
        PageDirection::Redo => (&history.redo, &history.undo),
    };
    let step = from.last()?.clone();
    let rest = from[..from.len() - 1].to_vec();
    let mut moved = to.clone();
    moved.push(step.clone());
    let history = match direction {
        PageDirection::Undo => PageHistory {
            undo: rest,
            redo: moved,
        },
        PageDirection::Redo => PageHistory {
            undo: moved,
            redo: rest,
        },
    };
    Some(TakenPageStep { history, step })
}
