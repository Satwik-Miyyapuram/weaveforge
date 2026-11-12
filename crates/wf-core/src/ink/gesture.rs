//! The pointer gesture's route choice and the stroke's cut at the paper's edge
//! (wf-core `ink::gesture`). A port of `InkGesture.pick` and `StrokeEdgeSplit`
//! in `apps/web/src/features/ink/application/parts-1.ts`.
//!
//! The route is picked by asking the caller questions. Each question has side
//! effects or costs on the caller's side (a sweep begins, a callback runs), so
//! the picker asks them one at a time, in the order the old code asked, and only
//! when the old code would have asked. The caller answers each with a bool and
//! feeds it back until the picker reports a route.

use serde::{Deserialize, Serialize};

use super::clip_to_area::{DrawArea, Point, clip_segment_to_area, point_in_area};

/// The armed tool, as the gesture sees it. An unknown name reads as [`Tool::None`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "InkToolName"))]
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
    #[serde(other)]
    None,
}

/// What a pointer's gesture does from down to up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "InkRouteName"))]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "InkRouteQuestion"))]
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

/// A [`Step`] as JS sees it: `{ kind: "ask", question }` or
/// `{ kind: "route", route }`, with a `null` route leaving the down to the caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "InkRouteStep"))]
pub enum RouteStep {
    /// The caller must answer this question.
    Ask {
        /// The question to answer.
        question: Question,
    },
    /// The route is settled.
    Route {
        /// The route, or `None` to leave the down to the caller.
        route: Option<Route>,
    },
}

impl From<Step> for RouteStep {
    fn from(step: Step) -> Self {
        match step {
            Step::Ask(question) => RouteStep::Ask { question },
            Step::Done(route) => RouteStep::Route { route },
        }
    }
}

/// What the caller knows about the down before any question is asked. An absent
/// callback is never asked; its answer is the old `?.()` default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "InkRouteFacts"))]
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
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "EdgeStepResult"))]
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
        let on_paper = area.is_none_or(|a| point_in_area(a, at.x, at.y));
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

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use super::*;

    fn facts(tool: Tool) -> DownFacts {
        DownFacts {
            tool,
            tip_erases: true,
            pen_barrel: false,
            has_admit: false,
            has_hit_selection: false,
            has_intercept: false,
        }
    }

    /// Drives the picker, answering each question with `answer`. Returns the route and
    /// the questions asked, in order.
    fn run(facts: DownFacts, answer: impl Fn(Question) -> bool) -> (Option<Route>, Vec<Question>) {
        let mut picker = RoutePicker::new(facts);
        let mut asked = Vec::new();
        let mut step = picker.start();
        // The picker asks at most a handful of questions; the bound guards against a loop.
        for _ in 0..8 {
            match step {
                Step::Done(route) => return (route, asked),
                Step::Ask(question) => {
                    asked.push(question);
                    step = picker.answer(answer(question));
                }
            }
        }
        (None, asked)
    }

    fn area() -> DrawArea {
        DrawArea {
            left: 0.0,
            top: 0.0,
            right: 100.0,
            bottom: 100.0,
        }
    }

    fn at(x: f64, y: f64) -> Point {
        Point { x, y }
    }

    #[test]
    fn the_back_tip_erases_before_any_tool_is_asked() {
        let mut f = facts(Tool::Lasso);
        f.has_hit_selection = true;
        let (route, asked) = run(f, |q| q == Question::SweepTip);
        assert_eq!(route, Some(Route::Erase));
        assert_eq!(asked, vec![Question::SweepTip]);
    }

    #[test]
    fn the_back_tip_draws_when_the_surface_says_it_does_not_erase() {
        let (route, _) = run(facts(Tool::Draw), |_| false);
        assert_eq!(route, Some(Route::Draw));
    }

    #[test]
    fn the_lasso_drags_a_hit_selection_and_lassos_anything_else() {
        let mut hit = facts(Tool::Lasso);
        hit.has_hit_selection = true;
        assert_eq!(
            run(hit, |q| q == Question::HitSelection).0,
            Some(Route::Drag)
        );

        let mut miss = facts(Tool::Lasso);
        miss.has_hit_selection = true;
        assert_eq!(run(miss, |_| false).0, Some(Route::Lasso));

        assert_eq!(run(facts(Tool::Lasso), |_| false).0, Some(Route::Lasso));
    }

    #[test]
    fn no_tool_and_a_refused_pointer_leave_the_down_to_the_caller() {
        assert_eq!(run(facts(Tool::None), |_| false).0, None);

        let mut refused = facts(Tool::Draw);
        refused.has_admit = true;
        assert_eq!(run(refused, |_| false).0, None);
    }

    #[test]
    fn the_eraser_tool_erases_an_intercept_wins_over_drawing_a_region_tool_picks_a_region() {
        let mut eraser = facts(Tool::Eraser);
        eraser.has_intercept = true;
        assert_eq!(
            run(eraser, |q| q == Question::SweepTool).0,
            Some(Route::Erase)
        );

        let mut intercepted = facts(Tool::Draw);
        intercepted.has_intercept = true;
        assert_eq!(
            run(intercepted, |q| q == Question::Intercept).0,
            Some(Route::Intercept)
        );

        assert_eq!(run(facts(Tool::Region), |_| false).0, Some(Route::Region));
        assert_eq!(run(facts(Tool::Draw), |_| false).0, Some(Route::Draw));
    }

    #[test]
    fn the_barrel_button_held_with_a_writing_tool_lassos_instead_of_drawing() {
        let mut barrel = facts(Tool::Draw);
        barrel.pen_barrel = true;
        assert_eq!(run(barrel, |_| false).0, Some(Route::Lasso));

        let mut barrel_eraser = facts(Tool::Eraser);
        barrel_eraser.pen_barrel = true;
        assert_eq!(run(barrel_eraser, |_| false).0, Some(Route::Lasso));

        let mut barrel_hit = facts(Tool::Draw);
        barrel_hit.pen_barrel = true;
        barrel_hit.has_hit_selection = true;
        assert_eq!(
            run(barrel_hit, |q| q == Question::HitSelection).0,
            Some(Route::Drag)
        );
    }

    #[test]
    fn the_barrel_button_leaves_no_tool_region_refused_pointers_and_the_mouse_alone() {
        let mut none = facts(Tool::None);
        none.pen_barrel = true;
        assert_eq!(run(none, |_| false).0, None);

        let mut region = facts(Tool::Region);
        region.pen_barrel = true;
        assert_eq!(run(region, |_| false).0, Some(Route::Region));

        let mut refused = facts(Tool::Draw);
        refused.pen_barrel = true;
        refused.has_admit = true;
        assert_eq!(run(refused, |_| false).0, None);

        // The mouse never reports the barrel, so the caller leaves `pen_barrel` false.
        assert_eq!(run(facts(Tool::Draw), |_| false).0, Some(Route::Draw));
    }

    #[test]
    fn a_plain_pen_and_the_back_tip_are_unchanged_by_barrel_support() {
        assert_eq!(run(facts(Tool::Draw), |_| false).0, Some(Route::Draw));
        assert_eq!(
            run(facts(Tool::Draw), |q| q == Question::SweepTip).0,
            Some(Route::Erase)
        );
    }

    #[test]
    fn a_stroke_leaving_the_page_is_cut_at_the_edge_and_resumes_where_it_returns() {
        let page = area();
        let mut edge = StrokeEdgeSplit::default();
        edge.begin(at(50.0, 50.0));
        assert_eq!(edge.move_to(at(50.0, 90.0), Some(&page)), EdgeStep::Inside);
        assert_eq!(
            edge.move_to(at(50.0, 110.0), Some(&page)),
            EdgeStep::Exit {
                at: at(50.0, 100.0)
            }
        );
        assert!(edge.outside());
        assert_eq!(
            edge.move_to(at(60.0, 130.0), Some(&page)),
            EdgeStep::Outside
        );
        assert_eq!(
            edge.move_to(at(60.0, 90.0), Some(&page)),
            EdgeStep::Enter {
                at: at(60.0, 100.0)
            }
        );
        assert!(!edge.outside());
        assert!(!edge.end());
    }

    #[test]
    fn end_reports_a_stroke_that_finished_off_the_page() {
        let page = area();
        let mut edge = StrokeEdgeSplit::default();
        edge.begin(at(50.0, 50.0));
        let _ = edge.move_to(at(50.0, 150.0), Some(&page));
        assert!(edge.end());
        assert!(!edge.outside());
    }

    #[test]
    fn an_area_open_to_the_sides_cuts_only_top_and_bottom() {
        let band = DrawArea {
            left: f64::NEG_INFINITY,
            right: f64::INFINITY,
            top: 0.0,
            bottom: 100.0,
        };
        let mut edge = StrokeEdgeSplit::default();
        edge.begin(at(50.0, 50.0));
        assert_eq!(
            edge.move_to(at(5000.0, 60.0), Some(&band)),
            EdgeStep::Inside
        );
        let exit = edge.move_to(at(5010.0, 120.0), Some(&band));
        assert!(matches!(exit, EdgeStep::Exit { at } if at.x.is_finite() && at.y == 100.0));
    }

    #[test]
    fn a_null_area_is_all_paper() {
        let mut edge = StrokeEdgeSplit::default();
        edge.begin(at(0.0, 0.0));
        assert_eq!(edge.move_to(at(-999.0, 999.0), None), EdgeStep::Inside);
    }
}
