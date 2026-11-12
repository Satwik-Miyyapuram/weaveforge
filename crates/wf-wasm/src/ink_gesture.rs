//! The ink pointer gesture (wf-core `ink::gesture`): the route picker and the
//! stroke's cut at the paper's edge. The picker asks each question in turn; the
//! caller answers it and feeds the answer back, so a callback runs only when the
//! route needs it. Each step crosses as a `B.InkRouteStep`. The DOM, pointer
//! events and the eraser cursor stay in
//! `apps/web/src/features/ink/application/parts-1.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::clip_to_area::{DrawArea, Point};
use wf_core::ink::gesture::{DownFacts, RoutePicker, RouteStep, Step, StrokeEdgeSplit as Core};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

fn step_js(step: Step) -> JsResult<JsValue> {
    to_js(&RouteStep::from(step))
}

/// [`RoutePicker`]: one down's route picker, built per down and driven to a route.
#[wasm_bindgen]
pub struct InkRoutePicker {
    inner: RoutePicker,
}

#[wasm_bindgen]
impl InkRoutePicker {
    /// A picker for a down with these facts; an unknown `tool` reads as `"none"`.
    ///
    /// # Errors
    ///
    /// Fails if `facts` is not an `InkRouteFacts` object.
    #[wasm_bindgen(constructor)]
    pub fn new(
        #[wasm_bindgen(unchecked_param_type = "B.InkRouteFacts")] facts: JsValue,
    ) -> JsResult<InkRoutePicker> {
        let facts: DownFacts = serde_wasm_bindgen::from_value(facts)?;
        Ok(InkRoutePicker {
            inner: RoutePicker::new(facts),
        })
    }

    /// The first step: the back-tip sweep question.
    ///
    /// # Errors
    ///
    /// Fails only if the step cannot be converted to a JS value.
    #[wasm_bindgen(unchecked_return_type = "B.InkRouteStep")]
    pub fn start(&mut self) -> JsResult<JsValue> {
        step_js(self.inner.start())
    }

    /// Feeds the answer to the last question and returns the next step.
    ///
    /// # Errors
    ///
    /// Fails only if the step cannot be converted to a JS value.
    #[wasm_bindgen(unchecked_return_type = "B.InkRouteStep")]
    pub fn answer(&mut self, yes: bool) -> JsResult<JsValue> {
        step_js(self.inner.answer(yes))
    }
}

/// [`StrokeEdgeSplit`](Core): one stroke against the drawable area.
#[wasm_bindgen]
pub struct StrokeEdgeSplit {
    inner: Core,
}

#[wasm_bindgen]
impl StrokeEdgeSplit {
    /// A split with no stroke begun.
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

    /// Starts a stroke at `at`.
    ///
    /// # Errors
    ///
    /// Fails if `at` is not a point.
    pub fn begin(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "B.Point")] at: JsValue,
    ) -> JsResult<()> {
        let at: Point = serde_wasm_bindgen::from_value(at)?;
        self.inner.begin(at);
        Ok(())
    }

    /// One move as `{ kind, at? }`. A `null` area means everywhere is paper.
    ///
    /// # Errors
    ///
    /// Fails if `at` is not a point, the area cannot be read, or the step cannot
    /// be serialised.
    #[wasm_bindgen(js_name = move, unchecked_return_type = "B.EdgeStepResult")]
    pub fn move_to(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "B.Point")] at: JsValue,
        #[wasm_bindgen(unchecked_param_type = "B.DrawArea | null")] area: JsValue,
    ) -> JsResult<JsValue> {
        let at: Point = serde_wasm_bindgen::from_value(at)?;
        let area: Option<DrawArea> = if area.is_null() || area.is_undefined() {
            None
        } else {
            Some(serde_wasm_bindgen::from_value(area)?)
        };
        to_js(&self.inner.move_to(at, area.as_ref()))
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
