//! 1-Euro pen filter for JavaScript (wf-core `ink::one_euro`): the smoothing factor and
//! the stateful filter handles.

use serde::Deserialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::one_euro::{
    self, NibFilter as CoreNibFilter, NibFilterState, NibSample,
    OneEuroFilter as CoreOneEuroFilter, OneEuroOptions,
};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`one_euro_alpha`](one_euro::one_euro_alpha): the smoothing factor for a cutoff in
/// hertz and a timestep in milliseconds.
#[wasm_bindgen(js_name = oneEuroAlpha)]
pub fn one_euro_alpha_js(cutoff: f64, dt_ms: f64) -> f64 {
    one_euro::one_euro_alpha(cutoff, dt_ms)
}

/// The JS shape of [`OneEuroOptions`].
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptionsJs {
    min_cutoff: f64,
    beta: f64,
    derivative_cutoff: f64,
}

fn options_from(value: JsValue) -> JsResult<OneEuroOptions> {
    let js: OptionsJs = serde_wasm_bindgen::from_value(value)?;
    Ok(OneEuroOptions {
        min_cutoff: js.min_cutoff,
        beta: js.beta,
        derivative_cutoff: js.derivative_cutoff,
    })
}

/// [`OneEuroFilter`](CoreOneEuroFilter): one scalar channel, held across calls.
#[wasm_bindgen]
pub struct OneEuroFilter {
    inner: CoreOneEuroFilter,
}

#[wasm_bindgen]
impl OneEuroFilter {
    /// `options` is `{ minCutoff, beta, derivativeCutoff }`.
    #[wasm_bindgen(constructor)]
    pub fn new(options: JsValue) -> JsResult<OneEuroFilter> {
        Ok(Self {
            inner: CoreOneEuroFilter::new(options_from(options)?),
        })
    }

    /// The last filtered value, or `undefined` before the first sample.
    #[wasm_bindgen(getter)]
    pub fn last(&self) -> Option<f64> {
        self.inner.last()
    }

    /// The last estimated speed, in value units per millisecond.
    #[wasm_bindgen(getter)]
    pub fn speed(&self) -> f64 {
        self.inner.speed()
    }

    /// Forget everything, as at pen-down.
    pub fn reset(&mut self) {
        self.inner.reset();
    }

    /// Filter one sample taken at `time` milliseconds; returns the filtered value.
    pub fn filter(&mut self, value: f64, time: f64) -> f64 {
        self.inner.filter(value, time)
    }
}

/// An opaque snapshot of a [`NibFilter`], for [`NibFilter::restore`].
#[wasm_bindgen]
pub struct NibFilterSnapshot {
    state: NibFilterState,
}

/// [`NibFilter`](CoreNibFilter): the pen-level filter (position and pressure, one state).
#[wasm_bindgen]
pub struct NibFilter {
    inner: CoreNibFilter,
}

#[wasm_bindgen]
impl NibFilter {
    /// `position` and `pressure` are each `{ minCutoff, beta, derivativeCutoff }`.
    #[wasm_bindgen(constructor)]
    pub fn new(position: JsValue, pressure: JsValue) -> JsResult<NibFilter> {
        Ok(Self {
            inner: CoreNibFilter::new(options_from(position)?, options_from(pressure)?),
        })
    }

    /// The filter's own speed estimate for the newest sample, for diagnostics.
    #[wasm_bindgen(getter)]
    pub fn speed(&self) -> f64 {
        self.inner.speed()
    }

    /// Start a new stroke: no state carries over from the last one.
    pub fn reset(&mut self) {
        self.inner.reset();
    }

    /// Filter one raw sample. Returns `[x, y, pressure, velocity, t]`.
    pub fn filter(&mut self, x: f64, y: f64, pressure: f64, t: f64) -> Vec<f64> {
        let out = self.inner.filter(NibSample { x, y, pressure, t });
        vec![out.x, out.y, out.pressure, out.velocity, out.t]
    }

    /// Snapshot the state, to pass to [`Self::restore`] later.
    pub fn save(&self) -> NibFilterSnapshot {
        NibFilterSnapshot {
            state: self.inner.save(),
        }
    }

    /// Put back a state from [`Self::save`].
    pub fn restore(&mut self, snapshot: &NibFilterSnapshot) {
        self.inner.restore(snapshot.state);
    }
}
