//! Ink geometry, line segmentation and recognition helpers for JavaScript
//! (steps 5-2b, 5-2c). Each export wraps a `wf_core::ink` function; the JS
//! shapes match `packages/core/src/ink`.
//!
//! Point and pressure arrays cross as `Float64Array`s (flat x,y pairs), not
//! through serde. The live packer is the one class here, built by
//! `createInkStrokePacker`, as `VectorIndex` is by `createVectorIndex`.

use serde::Deserialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::PackedInkStroke;
use wf_core::ink::curve::{Side, ink_curve_at, ink_tangent_at};
use wf_core::ink::decode::{InkWordReadings, decode_ink_words};
use wf_core::ink::recognise::{
    INK_UNSURE_CONFIDENCE, INK_VOCABULARY_LIMIT, RecognisedLine, bands_coincide,
    ink_page_confidence, ink_page_summary, ink_vocabulary_hints, is_unsure_confidence,
    map_ink_confidence,
};
use wf_core::ink::segment::{
    INK_GROUP_WINDOW_MS, INK_LINE_BAND_RATIO, RecognisedLineText, SegmentStroke, ink_line_records,
    segment_ink_lines,
};
use wf_core::ink::shape_snap::snap_ink_shape;
use wf_core::ink::smooth::{
    INK_SMOOTH_SPACING, binomial_smooth, resample_ink_stroke, smooth_ink_stroke,
};
use wf_core::ink::stroke_packer::{
    InkStrokePacker as CorePacker, InkStrokePackerOptions, pack_ink_stroke,
};
use wf_core::ink::width::{
    INK_PEN_WIDTH, INK_VELOCITY_FULL_TAPER, clamp_ink_note_width, ink_pressure_factor,
    ink_velocity_between, ink_velocity_factor, nib_width, stroke_base_width,
};
use wf_core::ink::zoom::{clamp_ink_zoom, ink_zoom_in, ink_zoom_out};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

fn packer_options(options: JsValue) -> JsResult<InkStrokePackerOptions> {
    if options.is_undefined() || options.is_null() {
        Ok(InkStrokePackerOptions::default())
    } else {
        serde_wasm_bindgen::from_value(options)
    }
}

/// [`ink_tangent_at`] as `[x, y]`; `side` is `"in"` or `"out"` (anything else is `"out"`).
/// An index past the end gives `[0, 0]`, as the TS copy does.
#[wasm_bindgen(js_name = inkTangentAt)]
#[must_use]
pub fn ink_tangent_at_js(xs: &[f64], ys: &[f64], i: u32, side: &str) -> Vec<f64> {
    let i = i as usize;
    if i >= xs.len().min(ys.len()) {
        return vec![0.0, 0.0];
    }
    let side = if side == "in" { Side::In } else { Side::Out };
    let (x, y) = ink_tangent_at(xs, ys, i, side);
    vec![x, y]
}

/// [`ink_curve_at`] as `[x, y]`. A span past the end gives `[NaN, NaN]`, as
/// the TS copy's out-of-range reads do.
#[wasm_bindgen(js_name = inkCurveAt)]
#[must_use]
pub fn ink_curve_at_js(xs: &[f64], ys: &[f64], i: u32, u: f64) -> Vec<f64> {
    let i = i as usize;
    if i + 1 >= xs.len().min(ys.len()) {
        return vec![f64::NAN, f64::NAN];
    }
    let (x, y) = ink_curve_at(xs, ys, i, u);
    vec![x, y]
}

/// [`resample_ink_stroke`] as `{ points, pressures }`.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = resampleInkStroke, unchecked_return_type = "B.PackedInkStroke")]
pub fn resample_ink_stroke_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] points: &[f64],
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] pressures: &[f64],
    spacing: Option<f64>,
) -> JsResult<JsValue> {
    let (points, pressures) =
        resample_ink_stroke(points, pressures, spacing.unwrap_or(INK_SMOOTH_SPACING));
    to_js(&PackedInkStroke { points, pressures })
}

/// [`binomial_smooth`].
#[wasm_bindgen(js_name = binomialSmooth)]
#[must_use]
pub fn binomial_smooth_js(values: &[f64], stride: u32, passes: f64) -> Vec<f64> {
    binomial_smooth(values, stride as usize, js_passes(passes))
}

/// A JS `pass < passes` loop count: a fraction rounds up, NaN or negative runs none.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn js_passes(passes: f64) -> u32 {
    passes.max(0.0).ceil() as u32
}

/// The TS `smoothInkStroke` options; a missing field takes the default.
#[derive(Deserialize, Default)]
struct SmoothOptions {
    spacing: Option<f64>,
    passes: Option<f64>,
}

/// [`smooth_ink_stroke`] as `{ points, pressures }`; `options` is
/// `{ spacing?, passes? }` or undefined.
///
/// # Errors
///
/// Fails if `options` is not an options object.
#[wasm_bindgen(js_name = smoothInkStroke)]
pub fn smooth_ink_stroke_js(
    points: &[f64],
    pressures: &[f64],
    options: JsValue,
) -> JsResult<JsValue> {
    let o: SmoothOptions = if options.is_undefined() || options.is_null() {
        SmoothOptions::default()
    } else {
        serde_wasm_bindgen::from_value(options)?
    };
    let passes = o.passes.map(js_passes);
    let (points, pressures) = smooth_ink_stroke(points, pressures, o.spacing, passes);
    to_js(&PackedInkStroke { points, pressures })
}

/// [`clamp_ink_note_width`]; `fallback` defaults to the default pen.
#[wasm_bindgen(js_name = clampInkNoteWidth)]
#[must_use]
pub fn clamp_ink_note_width_js(width: f64, fallback: Option<f64>) -> f64 {
    clamp_ink_note_width(width, fallback.unwrap_or(INK_PEN_WIDTH))
}

/// [`ink_pressure_factor`].
#[wasm_bindgen(js_name = inkPressureFactor)]
#[must_use]
pub fn ink_pressure_factor_js(pressure: Option<f64>) -> f64 {
    ink_pressure_factor(pressure)
}

/// [`ink_velocity_factor`]; `fullTaper` defaults to `INK_VELOCITY_FULL_TAPER`.
#[wasm_bindgen(js_name = inkVelocityFactor)]
#[must_use]
pub fn ink_velocity_factor_js(velocity: f64, full_taper: Option<f64>) -> f64 {
    ink_velocity_factor(velocity, full_taper.unwrap_or(INK_VELOCITY_FULL_TAPER))
}

/// [`nib_width`]; `velocity` defaults to 0.
#[wasm_bindgen(js_name = nibWidth)]
#[must_use]
pub fn nib_width_js(
    base: f64,
    pressure: Option<f64>,
    velocity: Option<f64>,
    full_taper: Option<f64>,
) -> f64 {
    nib_width(base, pressure, velocity.unwrap_or(0.0), full_taper)
}

/// [`ink_velocity_between`].
#[wasm_bindgen(js_name = inkVelocityBetween)]
#[must_use]
pub fn ink_velocity_between_js(x0: f64, y0: f64, t0: f64, x1: f64, y1: f64, t1: f64) -> f64 {
    ink_velocity_between(x0, y0, t0, x1, y1, t1)
}

/// [`stroke_base_width`].
#[wasm_bindgen(js_name = strokeBaseWidth)]
#[must_use]
pub fn stroke_base_width_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] samples: &[f64],
    base: f64,
) -> f64 {
    stroke_base_width(samples, base)
}

/// [`clamp_ink_zoom`].
#[wasm_bindgen(js_name = clampInkZoom)]
#[must_use]
pub fn clamp_ink_zoom_js(zoom: f64) -> f64 {
    clamp_ink_zoom(zoom)
}

/// [`wf_core::ink::pressure_byte`].
#[wasm_bindgen(js_name = pressureByte)]
#[must_use]
pub fn pressure_byte_js(pressure: Option<f64>) -> f64 {
    wf_core::ink::pressure_byte(pressure)
}

/// [`ink_zoom_in`].
#[wasm_bindgen(js_name = inkZoomIn)]
#[must_use]
pub fn ink_zoom_in_js(zoom: f64) -> f64 {
    ink_zoom_in(zoom)
}

/// [`ink_zoom_out`].
#[wasm_bindgen(js_name = inkZoomOut)]
#[must_use]
pub fn ink_zoom_out_js(zoom: f64) -> f64 {
    ink_zoom_out(zoom)
}

/// [`pack_ink_stroke`] as `{ points, pressures }`; `options` is the TS
/// `InkStrokePackerOptions` or undefined.
///
/// # Errors
///
/// Fails if `options` is not an options object.
#[wasm_bindgen(js_name = packInkStroke)]
pub fn pack_ink_stroke_js(
    points: &[f64],
    pressures: &[f64],
    options: JsValue,
) -> JsResult<JsValue> {
    let packed = pack_ink_stroke(points, pressures, packer_options(options)?);
    to_js(&packed)
}

/// The live packer: [`CorePacker`] fed one pen sample at a time, so the
/// stroke drawn while writing is the one saved on lift.
#[wasm_bindgen]
pub struct InkStrokePacker {
    inner: CorePacker,
}

#[wasm_bindgen]
impl InkStrokePacker {
    /// Adds the pen's next sample, in 0.1 mm, with its 0-255 pressure if it
    /// has one. A non-finite sample is skipped.
    pub fn push(&mut self, x: f64, y: f64, pressure: Option<f64>) {
        self.inner.push(x, y, pressure);
    }

    /// The kept points so far, then the pen's latest sample, as flat x,y pairs.
    #[must_use]
    pub fn points(&self) -> Vec<f64> {
        self.inner.packed().points
    }

    /// One pressure byte per point of [`InkStrokePacker::points`].
    #[must_use]
    pub fn pressures(&self) -> Vec<f64> {
        self.inner.packed().pressures
    }
}

/// A new [`InkStrokePacker`]; `options` is the TS `InkStrokePackerOptions`
/// or undefined.
///
/// # Errors
///
/// Fails if `options` is not an options object.
#[wasm_bindgen(js_name = createInkStrokePacker)]
pub fn create_ink_stroke_packer(options: JsValue) -> JsResult<InkStrokePacker> {
    Ok(InkStrokePacker {
        inner: CorePacker::new(packer_options(options)?),
    })
}
/// [`segment_ink_lines`] over strokes passed flat: stroke `i`'s points are
/// `points[offsets[i]..offsets[i + 1]]`, `pen[i]` is 1 for a pen stroke, and
/// `t0s[i]` its start (NaN when missing). Returns line indices into the strokes.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = segmentInkLines)]
pub fn segment_ink_lines_js(
    points: &[f64],
    offsets: &[u32],
    pen: &[u8],
    t0s: &[f64],
    window_ms: Option<f64>,
    band_ratio: Option<f64>,
) -> JsResult<JsValue> {
    let strokes: Vec<SegmentStroke> = offsets
        .windows(2)
        .zip(pen.iter().zip(t0s))
        .map(|(span, (&is_pen, &t0))| SegmentStroke {
            points: points
                .get(span[0] as usize..span[1] as usize)
                .unwrap_or_default()
                .to_vec(),
            tool: if is_pen == 1 { "pen" } else { "" }.to_owned(),
            t0: Some(t0),
        })
        .collect();
    to_js(&segment_ink_lines(
        &strokes,
        window_ms.unwrap_or(INK_GROUP_WINDOW_MS),
        band_ratio.unwrap_or(INK_LINE_BAND_RATIO),
    ))
}

/// [`ink_line_records`]: `counts[i]` strokes per line, `bands` as flat
/// `yMin, yMax` pairs, `recognised` an array of `{ text, confidence }` or
/// undefined per line.
///
/// # Errors
///
/// Fails if `recognised` is not such an array.
#[wasm_bindgen(js_name = inkLineRecords)]
pub fn ink_line_records_js(
    counts: &[u32],
    bands: &[f64],
    recognised: JsValue,
) -> JsResult<JsValue> {
    let recognised: Vec<Option<RecognisedLineText>> =
        if recognised.is_undefined() || recognised.is_null() {
            Vec::new()
        } else {
            serde_wasm_bindgen::from_value(recognised)?
        };
    let lines: Vec<(u32, [f64; 2])> = counts
        .iter()
        .zip(bands.as_chunks::<2>().0)
        .map(|(&count, &band)| (count, band))
        .collect();
    to_js(&ink_line_records(&lines, &recognised))
}

/// [`is_unsure_confidence`].
#[wasm_bindgen(js_name = isUnsureConfidence)]
#[must_use]
pub fn is_unsure_confidence_js(conf: f64) -> bool {
    is_unsure_confidence(conf)
}

/// [`map_ink_confidence`]; `scale` defaults to 1.
#[wasm_bindgen(js_name = mapInkConfidence)]
#[must_use]
pub fn map_ink_confidence_js(raw: f64, scale: Option<f64>) -> f64 {
    map_ink_confidence(raw, scale.unwrap_or(1.0))
}

/// [`ink_page_confidence`] over the lines' `conf` values.
#[wasm_bindgen(js_name = inkPageConfidence)]
#[must_use]
pub fn ink_page_confidence_js(confs: &[f64]) -> f64 {
    ink_page_confidence(confs)
}

/// [`INK_UNSURE_CONFIDENCE`], read at call time.
#[wasm_bindgen(js_name = inkUnsureConfidence)]
#[must_use]
pub fn ink_unsure_confidence_js() -> f64 {
    INK_UNSURE_CONFIDENCE
}

/// [`bands_coincide`] for two y-bands given as `(start, end)` pairs, flattened.
#[wasm_bindgen(js_name = bandsCoincide)]
#[must_use]
pub fn bands_coincide_js(a_start: f64, a_end: f64, b_start: f64, b_end: f64) -> bool {
    bands_coincide((a_start, a_end), (b_start, b_end))
}

/// [`band_union`](wf_core::ink::recognise::band_union) over flat `start, end` pairs: the
/// spanning `[start, end]`, or `[]` when there are none.
#[wasm_bindgen(js_name = inkBandUnion)]
#[must_use]
pub fn ink_band_union_js(bands: &[f64]) -> Vec<f64> {
    wf_core::ink::recognise::band_union(bands)
        .map(|(start, end)| vec![start, end])
        .unwrap_or_default()
}

/// [`capped_engine_confidence`](wf_core::ink::decode::capped_engine_confidence): an engine's
/// line confidence capped at the engine maximum.
#[wasm_bindgen(js_name = cappedEngineConfidence)]
#[must_use]
pub fn capped_engine_confidence_js(conf: f64) -> f64 {
    wf_core::ink::decode::capped_engine_confidence(conf)
}

/// [`ink_page_summary`] over `{ text, conf }` lines: `{ text, confidence, unsure }`.
///
/// # Errors
///
/// Fails if `lines` is not an array of `{ text: string, conf: number }`.
#[wasm_bindgen(js_name = inkPageSummary)]
pub fn ink_page_summary_js(lines: JsValue) -> JsResult<JsValue> {
    let lines: Vec<RecognisedLine> = serde_wasm_bindgen::from_value(lines)?;
    to_js(&ink_page_summary(&lines))
}

/// [`ink_vocabulary_hints`]; `limit` defaults to 500.
///
/// # Errors
///
/// Fails if `sources` is not an array of string arrays.
#[wasm_bindgen(js_name = inkVocabularyHints, unchecked_return_type = "string[]")]
pub fn ink_vocabulary_hints_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly string[])[]")] sources: JsValue,
    limit: Option<f64>,
) -> JsResult<JsValue> {
    let sources: Vec<Vec<String>> = serde_wasm_bindgen::from_value(sources)?;
    to_js(&ink_vocabulary_hints(
        &sources,
        limit.unwrap_or(INK_VOCABULARY_LIMIT),
    ))
}

/// [`decode_ink_words`]: `words` is an array of `{ candidates, known?, join? }`,
/// `vocabulary` an array of strings.
///
/// # Errors
///
/// Fails if `words` or `vocabulary` is not such an array.
#[wasm_bindgen(js_name = decodeInkWords)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
pub fn decode_ink_words_js(
    words: JsValue,
    vocabulary: JsValue,
    engine_text: Option<String>,
) -> JsResult<JsValue> {
    let words: Vec<InkWordReadings> = serde_wasm_bindgen::from_value(words)?;
    let vocabulary: Vec<String> = serde_wasm_bindgen::from_value(vocabulary)?;
    to_js(&decode_ink_words(
        &words,
        &vocabulary,
        engine_text.as_deref(),
    ))
}

/// [`ink_vocabulary_words`](wf_core::ink::decode::ink_vocabulary_words), sorted
/// (TS `inkVocabularyWords`; the TS wrapper makes it a `Set`).
///
/// # Errors
///
/// Fails if `vocabulary` is not an array of strings.
#[wasm_bindgen(js_name = inkVocabularyWordList)]
pub fn ink_vocabulary_word_list_js(vocabulary: JsValue) -> JsResult<JsValue> {
    let vocabulary: Vec<String> = serde_wasm_bindgen::from_value(vocabulary)?;
    let mut words: Vec<String> = wf_core::ink::decode::ink_vocabulary_words(&vocabulary)
        .into_iter()
        .collect();
    words.sort_unstable();
    to_js(&words)
}

/// [`ink_stroke_band`](wf_core::ink::segment::ink_stroke_band): `[yMin, yMax]` over a
/// stroke's flat x,y points, or `undefined` when no y is finite.
#[wasm_bindgen(js_name = inkStrokeBandOf)]
#[must_use]
pub fn ink_stroke_band_js(points: &[f64]) -> Option<Vec<f64>> {
    wf_core::ink::segment::ink_stroke_band(points).map(|(lo, hi)| vec![lo, hi])
}

/// Fit a line, rect, ellipse or arrow to a finished mark (Rust `snap_ink_shape`).
/// `null` when the recogniser abstains.
#[wasm_bindgen(js_name = snapInkShape, unchecked_return_type = "{ points: number[]; shape: Exclude<B.InkShape, \"none\"> } | null")]
pub fn snap_ink_shape_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] points: &[f64],
) -> JsResult<JsValue> {
    snap_ink_shape(points).map_or(Ok(JsValue::NULL), |snapped| to_js(&snapped))
}
