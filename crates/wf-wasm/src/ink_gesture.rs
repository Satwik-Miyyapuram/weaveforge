//! The ink pointer gesture (wf-core `ink::gesture`), re-exported from
//! `packages/wf-wasm/src/ink-gesture.ts`. The route picker returns each step as a
//! string: `"ask:<question>"` or `"route:<route>"`, with `"route:none"` leaving the
//! down to the caller. The DOM, pointer events and the eraser cursor stay in
//! `apps/web/src/features/ink/application/ink-gesture.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::clip_to_area::{DrawArea, Point};
use wf_core::ink::gesture::{
    DownFacts, EdgeStep, Question, Route, RoutePicker, Step, StrokeEdgeSplit as Core, Tool,
};

use super::to_js;

fn tool_of(name: &str) -> Tool {
    match name {
        "draw" => Tool::Draw,
        "eraser" => Tool::Eraser,
        "lasso" => Tool::Lasso,
        "region" => Tool::Region,
        _ => Tool::None,
    }
}

fn question_name(question: Question) -> &'static str {
    match question {
        Question::SweepTip => "sweepTip",
        Question::Admit => "admit",
        Question::HitSelection => "hitSelection",
        Question::SweepTool => "sweepTool",
        Question::Intercept => "intercept",
    }
}

fn route_name(route: Option<Route>) -> &'static str {
    match route {
        Some(Route::Erase) => "erase",
        Some(Route::Intercept) => "intercept",
        Some(Route::Drag) => "drag",
        Some(Route::Lasso) => "lasso",
        Some(Route::Draw) => "draw",
        Some(Route::Region) => "region",
        None => "none",
    }
}

fn step_name(step: Step) -> String {
    match step {
        Step::Ask(question) => format!("ask:{}", question_name(question)),
        Step::Done(route) => format!("route:{}", route_name(route)),
    }
}

/// [`RoutePicker`]: picks one down's route, asking the caller each question in turn.
#[wasm_bindgen]
pub struct InkRoutePicker {
    inner: RoutePicker,
}

#[wasm_bindgen]
impl InkRoutePicker {
    /// `tool` is `"draw"`, `"eraser"`, `"lasso"`, `"region"` or `"none"`.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(
        tool: &str,
        tip_erases: bool,
        pen_barrel: bool,
        has_admit: bool,
        has_hit_selection: bool,
        has_intercept: bool,
    ) -> InkRoutePicker {
        InkRoutePicker {
            inner: RoutePicker::new(DownFacts {
                tool: tool_of(tool),
                tip_erases,
                pen_barrel,
                has_admit,
                has_hit_selection,
                has_intercept,
            }),
        }
    }

    /// The first step, usually `"ask:sweepTip"`.
    pub fn start(&mut self) -> String {
        step_name(self.inner.start())
    }

    /// Feeds the answer to the last question and returns the next step.
    pub fn answer(&mut self, yes: bool) -> String {
        step_name(self.inner.answer(yes))
    }
}

fn edge_step_js(step: EdgeStep) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&step)
}

/// [`StrokeEdgeSplit`](Core): one stroke against the drawable area.
#[wasm_bindgen]
pub struct StrokeEdgeSplit {
    inner: Core,
}

#[wasm_bindgen]
impl StrokeEdgeSplit {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> StrokeEdgeSplit {
        StrokeEdgeSplit {
            inner: Core::default(),
        }
    }

    /// Whether the stroke is currently off the paper.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn outside(&self) -> bool {
        self.inner.outside()
    }

    pub fn begin(&mut self, x: f64, y: f64) {
        self.inner.begin(Point { x, y });
    }

    /// One move as `{ kind, at? }`. `area` is a `DrawArea`, or `null` for everywhere.
    ///
    /// # Errors
    ///
    /// Fails only if the area cannot be read or the step cannot be serialised.
    #[wasm_bindgen(js_name = move)]
    pub fn move_to(
        &mut self,
        x: f64,
        y: f64,
        area: JsValue,
    ) -> Result<JsValue, serde_wasm_bindgen::Error> {
        let area: Option<DrawArea> = if area.is_null() || area.is_undefined() {
            None
        } else {
            Some(serde_wasm_bindgen::from_value(area)?)
        };
        edge_step_js(self.inner.move_to(Point { x, y }, area.as_ref()))
    }

    /// Forgets the stroke; true when it ended off the paper.
    pub fn end(&mut self) -> bool {
        self.inner.end()
    }
}

impl Default for StrokeEdgeSplit {
    fn default() -> Self {
        Self::new()
    }
}
