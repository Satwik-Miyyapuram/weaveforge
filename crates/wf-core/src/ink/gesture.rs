//! The pointer gesture's route choice and the stroke's cut at the paper's edge
//! (wf-core `ink::gesture`). A port of `InkGesture.pick` and `StrokeEdgeSplit`
//! in `apps/web/src/features/ink/application/ink-gesture.ts`.
//!
//! The route is picked by asking the caller questions. Each question has side
//! effects or costs on the caller's side (a sweep begins, a callback runs), so
//! the picker asks them one at a time, in the order the old code asked, and only
//! when the old code would have asked. The caller answers each with a bool and
//! feeds it back until the picker reports a route.

use serde::{Deserialize, Serialize};

use super::clip_to_area::{DrawArea, Point, clip_segment_to_area, point_in_area};

/// The armed tool, as the gesture sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    /// The draw tool.
    Draw,
    /// The eraser tool.
    Eraser,
    /// The lasso tool.
    Lasso,
    /// The region tool.
    Region,
    /// No tool armed.
    None,
}

/// What a pointer's gesture does from down to up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    /// Erase under the pointer.
    Erase,
    /// The surface takes the down.
    Intercept,
    /// Drag the current selection.
    Drag,
    /// Start a lasso selection.
    Lasso,
    /// Draw a stroke.
    Draw,
    /// Start a region selection.
    Region,
}

/// A question the caller answers before the picker can go on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Question {
    /// Does the back tip sweep (`begin(event, false, tipErases)`)?
    SweepTip,
    /// Is this pointer admitted to draw?
    Admit,
    /// Does the down land on the current selection?
    HitSelection,
    /// Does the armed eraser sweep (`begin(event, tool === eraser, false)`)?
    SweepTool,
    /// Does the surface claim the down for itself?
    Intercept,
}

/// The picker's next move: ask a question, or stop with the route (`None` leaves
/// the down to the caller).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// The caller must answer this question.
    Ask(Question),
    /// The route is settled; `None` leaves the down to the caller.
    Done(Option<Route>),
}

/// What the caller knows about the down before any question is asked. An absent
/// callback is never asked; its answer is the old `?.()` default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DownFacts {
    /// The armed tool at the down.
    pub tool: Tool,
    /// Whether the pen's back tip erases on this surface right now.
    pub tip_erases: bool,
    /// Whether the pointer is the pen with its barrel button held.
    pub pen_barrel: bool,
    /// Whether an admit callback is present.
    pub has_admit: bool,
    /// Whether a hit-selection callback is present.
    pub has_hit_selection: bool,
    /// Whether an intercept callback is present.
    pub has_intercept: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    Start,
    AfterTip,
    AfterAdmit,
    AfterBarrelHit,
    AfterLassoHit,
    AfterSweepTool,
    AfterIntercept,
    Finished,
}

/// The route picker for one down. Built per down, then driven by `start` and
/// `answer` until a `Step::Done`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoutePicker {
    facts: DownFacts,
    stage: Stage,
}

impl RoutePicker {
    /// A picker for one down, not yet started.
    #[must_use]
    pub fn new(facts: DownFacts) -> Self {
        Self {
            facts,
            stage: Stage::Start,
        }
    }

    /// The first step: the back-tip sweep question.
    pub fn start(&mut self) -> Step {
        self.stage = Stage::AfterTip;
        Step::Ask(Question::SweepTip)
    }

    /// Feeds the answer to the last question asked and returns the next step.
    pub fn answer(&mut self, yes: bool) -> Step {
        match self.stage {
            Stage::AfterTip => {
                if yes {
                    return self.finish(Route::Erase);
                }
                self.after_tip()
            }
            Stage::AfterLassoHit | Stage::AfterBarrelHit => {
                self.finish(if yes { Route::Drag } else { Route::Lasso })
            }
            Stage::AfterAdmit => {
                if !yes {
                    return self.finish_none();
                }
                self.after_admit()
            }
            Stage::AfterSweepTool => {
                if yes {
                    return self.finish(Route::Erase);
                }
                self.before_intercept()
            }
            Stage::AfterIntercept => {
                if yes {
                    return self.finish(Route::Intercept);
                }
                self.finish_default()
            }
            Stage::Start | Stage::Finished => self.finish_none(),
        }
    }

    fn after_tip(&mut self) -> Step {
        if self.facts.tool == Tool::Lasso {
            if self.facts.has_hit_selection {
                self.stage = Stage::AfterLassoHit;
                return Step::Ask(Question::HitSelection);
            }
            return self.finish(Route::Lasso);
        }
        if self.facts.tool == Tool::None {
            return self.finish_none();
        }
        if self.facts.has_admit {
            self.stage = Stage::AfterAdmit;
            return Step::Ask(Question::Admit);
        }
        self.after_admit()
    }

    fn after_admit(&mut self) -> Step {
        if self.facts.tool != Tool::Region && self.facts.pen_barrel {
            if self.facts.has_hit_selection {
                self.stage = Stage::AfterBarrelHit;
                return Step::Ask(Question::HitSelection);
            }
            return self.finish(Route::Lasso);
        }
        self.stage = Stage::AfterSweepTool;
        Step::Ask(Question::SweepTool)
    }

    fn before_intercept(&mut self) -> Step {
        if self.facts.has_intercept {
            self.stage = Stage::AfterIntercept;
            return Step::Ask(Question::Intercept);
        }
        self.finish_default()
    }

    fn finish_default(&mut self) -> Step {
        let route = if self.facts.tool == Tool::Region {
            Route::Region
        } else {
            Route::Draw
        };
        self.finish(route)
    }

    fn finish(&mut self, route: Route) -> Step {
        self.stage = Stage::Finished;
        Step::Done(Some(route))
    }

    fn finish_none(&mut self) -> Step {
        self.stage = Stage::Finished;
        Step::Done(None)
    }
}

/// One move of a stroke against the paper's edge.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum EdgeStep {
    /// Still on the paper.
    Inside,
    /// Left the paper, ending the stroke at `at`.
    Exit {
        /// Where the stroke crosses the edge.
        at: Point,
    },
    /// Still off the paper.
    Outside,
    /// Back on the paper, starting a stroke at `at`.
    Enter {
        /// Where the stroke crosses the edge.
        at: Point,
    },
}

/// Tracks one stroke against the drawable area: the move that leaves it ends
/// the stroke at the crossing, and the move that returns starts a new one there.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct StrokeEdgeSplit {
    last: Option<Point>,
    out: bool,
}

impl StrokeEdgeSplit {
    /// Whether the stroke is currently off the paper.
    #[must_use]
    pub fn outside(&self) -> bool {
        self.out
    }

    /// Starts a stroke at `at`.
    pub fn begin(&mut self, at: Point) {
        self.last = Some(at);
        self.out = false;
    }

    /// A `None` area means everywhere is paper.
    pub fn move_to(&mut self, at: Point, area: Option<&DrawArea>) -> EdgeStep {
        let previous = self.last.unwrap_or(at);
        self.last = Some(at);
        let on_paper = area.map_or(true, |a| point_in_area(a, at.x, at.y));
        if self.out {
            if !on_paper {
                return EdgeStep::Outside;
            }
            self.out = false;
            let clipped = area.and_then(|a| clip_segment_to_area(a, previous, at));
            return EdgeStep::Enter {
                at: clipped.map_or(at, |c| c.from),
            };
        }
        if on_paper {
            return EdgeStep::Inside;
        }
        self.out = true;
        let clipped = area.and_then(|a| clip_segment_to_area(a, previous, at));
        EdgeStep::Exit {
            at: clipped.map_or(at, |c| c.to),
        }
    }

    /// Forgets the stroke; true when it ended off the paper.
    pub fn end(&mut self) -> bool {
        let was = self.out;
        self.out = false;
        self.last = None;
        was
    }
}
