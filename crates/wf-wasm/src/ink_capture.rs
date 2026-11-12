//! The pen's per-update sample batch for JavaScript (wf-core `ink::capture`).
//!
//! One call per pointer update, never per sample: the session flattens the update's
//! samples into a `Float64Array` of `x, y, pressure, t, timeStamp, flags` quadruples
//! and reads back one batch.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::capture::{CaptureSample, CaptureStream as CoreStream, OUT_STRIDE};

/// [`CaptureStream`](CoreStream): the filter and the last real sample across updates.
#[wasm_bindgen]
#[derive(Default)]
pub struct InkCaptureStream {
    inner: CoreStream,
}

#[wasm_bindgen]
impl InkCaptureStream {
    /// A stream with the tuned pen channels.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> InkCaptureStream {
        InkCaptureStream::default()
    }

    /// A new stroke: the filter starts clean.
    #[wasm_bindgen(js_name = resetFilter)]
    pub fn reset_filter(&mut self) {
        self.inner.reset_filter();
    }

    /// The stroke ended or was dropped: forget the last real sample.
    #[wasm_bindgen(js_name = forgetLast)]
    pub fn forget_last(&mut self) {
        self.inner.forget_last();
    }

    /// Filter one pointer update. `raw` is flat `x, y, pressure, t, timeStamp, flags`
    /// per sample (NaN for an absent `t` or `timeStamp`, NaN `x` for off the page);
    /// `now` is the fallback time.
    pub fn consume(&mut self, raw: &[f64], now: f64) -> InkCaptureBatch {
        InkCaptureBatch {
            samples: self.inner.consume(raw, now),
        }
    }
}

/// The accepted samples of one update, read back as typed arrays.
#[wasm_bindgen]
pub struct InkCaptureBatch {
    samples: Vec<CaptureSample>,
}

#[wasm_bindgen]
impl InkCaptureBatch {
    /// How many samples were accepted.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn count(&self) -> usize {
        self.samples.len()
    }

    /// Accepted samples as `x, y, pressure, t` quadruples. Doubles, as the filter
    /// computed them; the writer rounds to Float32 when it stores them.
    #[must_use]
    pub fn samples(&self) -> Vec<f64> {
        let mut out = Vec::with_capacity(self.samples.len() * OUT_STRIDE);
        for s in &self.samples {
            out.push(s.x);
            out.push(s.y);
            out.push(s.pressure);
            out.push(s.t);
        }
        out
    }

    /// One flag byte per accepted sample: `FLAG_PREDICTED` and `FLAG_DISPATCHED`.
    #[must_use]
    pub fn flags(&self) -> Vec<u8> {
        self.samples.iter().map(|s| s.flags as u8).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Batch layout: x, y, pressure, t per accepted sample, flags alongside.
    #[test]
    fn a_flushed_batch_carries_x_y_pressure_and_t_in_that_order() {
        let mut stream = InkCaptureStream::new();
        let raw = [10.0, 20.0, 0.5, 1.0, f64::NAN, 1.0];
        let batch = stream.consume(&raw, 0.0);
        assert_eq!(batch.count(), 1);
        let samples = batch.samples();
        assert_eq!(samples.len(), OUT_STRIDE);
        assert_eq!(samples[3], 1.0);
        assert_eq!(batch.flags(), vec![0u8]);
    }

    // An empty update yields an empty batch.
    #[test]
    fn an_empty_frame_yields_an_empty_batch() {
        let mut stream = InkCaptureStream::new();
        let batch = stream.consume(&[], 0.0);
        assert_eq!(batch.count(), 0);
        assert!(batch.samples().is_empty());
        assert!(batch.flags().is_empty());
    }
}
