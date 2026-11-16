//! 1-Euro pen filter for JavaScript (wf-core `ink::one_euro`): the smoothing factor and
//! the stateful filter handles.

use std::cell::RefCell;
use std::rc::Rc;

use serde::Deserialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::one_euro::{
    self, NibFilter as CoreNibFilter, NibSample, OneEuroFilter as CoreOneEuroFilter, OneEuroOptions,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`one_euro_alpha`](one_euro::one_euro_alpha): the smoothing factor for a cutoff in
/// hertz and a timestep in milliseconds.
#[wasm_bindgen(js_name = oneEuroAlpha)]
pub fn one_euro_alpha_js(cutoff: f64, dt_ms: f64) -> f64 {
    one_euro::one_euro_alpha(cutoff, dt_ms)
}

/// [`position_options`](one_euro::position_options) as `{ minCutoff, beta, derivativeCutoff }`.
/// Read at call time, so no app module holds a copy of the tuning.
#[wasm_bindgen(js_name = inkPositionOptions, unchecked_return_type = "B.OneEuroOptions")]
pub fn ink_position_options_js() -> JsResult<JsValue> {
    serde_wasm_bindgen::to_value(&one_euro::position_options())
}

/// [`pressure_options`](one_euro::pressure_options) as `{ minCutoff, beta, derivativeCutoff }`.
#[wasm_bindgen(js_name = inkPressureOptions, unchecked_return_type = "B.OneEuroOptions")]
pub fn ink_pressure_options_js() -> JsResult<JsValue> {
    serde_wasm_bindgen::to_value(&one_euro::pressure_options())
}

/// The JS shape of the [`NibFilter`] constructor's options.
#[derive(Deserialize)]
struct NibOptionsJs {
    position: OneEuroOptions,
    pressure: OneEuroOptions,
}

/// [`OneEuroFilter`](CoreOneEuroFilter): one scalar channel, held across calls.
#[wasm_bindgen]
pub struct OneEuroFilter {
    inner: CoreOneEuroFilter,
}

#[wasm_bindgen]
impl OneEuroFilter {
    /// `options` is `{ minCutoff, beta, derivativeCutoff }`.
    ///
    /// # Errors
    ///
    /// Fails if `options` is not a `OneEuroOptions`-shaped object.
    #[wasm_bindgen(constructor)]
    pub fn new(
        #[wasm_bindgen(unchecked_param_type = "B.OneEuroOptions")] options: JsValue,
    ) -> JsResult<OneEuroFilter> {
        let options: OneEuroOptions = serde_wasm_bindgen::from_value(options)?;
        Ok(Self {
            inner: CoreOneEuroFilter::new(options),
        })
    }

    /// The last filtered value, or `null` before the first sample.
    #[wasm_bindgen(getter, unchecked_return_type = "number | null")]
    #[must_use]
    pub fn last(&self) -> JsValue {
        self.inner.last().map_or(JsValue::NULL, JsValue::from_f64)
    }

    /// The last estimated speed, in value units per millisecond.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn speed(&self) -> f64 {
        self.inner.speed()
    }

    /// Forget everything. Called at pen-down: a new stroke is a new signal.
    pub fn reset(&mut self) {
        self.inner.reset();
    }

    /// Filter one sample taken at `time` milliseconds; returns the filtered value.
    pub fn filter(&mut self, value: f64, time: f64) -> f64 {
        self.inner.filter(value, time)
    }
}

/// [`NibFilter`](CoreNibFilter): the pen-level filter (position and pressure, one state).
/// The state is shared with the restore functions [`Self::save`] hands out.
#[wasm_bindgen]
pub struct NibFilter {
    inner: Rc<RefCell<CoreNibFilter>>,
}

#[wasm_bindgen]
impl NibFilter {
    /// `options` is `{ position, pressure }`, each `{ minCutoff, beta, derivativeCutoff }`.
    ///
    /// # Errors
    ///
    /// Fails if `options` does not hold two `OneEuroOptions`-shaped objects.
    #[wasm_bindgen(constructor)]
    pub fn new(
        #[wasm_bindgen(
            unchecked_param_type = "{ position: B.OneEuroOptions; pressure: B.OneEuroOptions }"
        )]
        options: JsValue,
    ) -> JsResult<NibFilter> {
        let options: NibOptionsJs = serde_wasm_bindgen::from_value(options)?;
        Ok(Self {
            inner: Rc::new(RefCell::new(CoreNibFilter::new(
                options.position,
                options.pressure,
            ))),
        })
    }

    /// The speed the filter saw, in 0.1 mm per ms, from the *raw* samples. Raw
    /// rather than filtered: the velocity taper is a drawing property.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn speed(&self) -> f64 {
        self.inner.borrow().speed()
    }

    /// Start a new stroke: no state carries over from the last one.
    pub fn reset(&mut self) {
        self.inner.borrow_mut().reset();
    }

    /// Filter one raw sample into `{ x, y, pressure, velocity, t }`.
    ///
    /// # Errors
    ///
    /// Fails if `sample` is not a `NibSample`-shaped object.
    #[wasm_bindgen(unchecked_return_type = "B.FilteredNibSample")]
    pub fn filter(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "B.NibSample")] sample: JsValue,
    ) -> JsResult<JsValue> {
        let sample: NibSample = serde_wasm_bindgen::from_value(sample)?;
        let out = self.inner.borrow_mut().filter(sample);
        to_js(&out)
    }

    /// Snapshot the filter now; the returned function restores that snapshot.
    #[wasm_bindgen(unchecked_return_type = "() => void")]
    #[must_use]
    pub fn save(&self) -> JsValue {
        let state = self.inner.borrow().save();
        let inner = Rc::clone(&self.inner);
        Closure::<dyn FnMut()>::new(move || inner.borrow_mut().restore(state)).into_js_value()
    }
}
