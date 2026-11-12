//! Ink geometry, line segmentation and recognition helpers for JavaScript
//! (steps 5-2b, 5-2c). Each export wraps a `wf_core::ink` function; the JS
//! shapes match `packages/core/src/ink`.
//!
//! Point and pressure arrays cross as plain number arrays or typed arrays
//! (flat x,y pairs), not through serde. The live packer is the one class here,
//! built by `createInkStrokePacker`, as `VectorIndex` is by `createVectorIndex`.

use js_sys::{Array, Object, Reflect};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
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

/// A missing (`undefined` or `null`) options object reads as `{}`.
fn packer_options(options: Option<JsValue>) -> JsResult<InkStrokePackerOptions> {
    match options {
        Some(options) if !options.is_undefined() && !options.is_null() => {
            serde_wasm_bindgen::from_value(options)
        }
        _ => Ok(InkStrokePackerOptions::default()),
    }
}

/// `obj[key]`; throws as the JS property read would on a non-object.
fn prop(obj: &JsValue, key: &str) -> Result<JsValue, JsValue> {
    Reflect::get(obj, &JsValue::from_str(key))
}

/// `obj[key] = value`.
fn set_prop(obj: &Object, key: &str, value: &JsValue) -> Result<(), JsValue> {
    Reflect::set(obj, &JsValue::from_str(key), value).map(|_| ())
}

/// `Float64Array.from(value)`: a number array or typed array copied as f64s.
fn f64s(value: &JsValue) -> Vec<f64> {
    js_sys::Float64Array::new(value).to_vec()
}

/// `[a, b]` as a JS array.
fn pair(a: f64, b: f64) -> JsValue {
    Array::of2(&JsValue::from_f64(a), &JsValue::from_f64(b)).into()
}

/// A `{ x, y }` point.
#[derive(Serialize)]
struct Xy {
    x: f64,
    y: f64,
}

/// [`ink_tangent_at`] as `{ x, y }`; `side` is `"in"` or `"out"` (default
/// `"out"`; anything else is `"out"`). An index past the end gives `{ x: 0, y: 0 }`.
///
/// # Errors
///
/// Fails only if the point cannot be converted to a JS value.
#[wasm_bindgen(js_name = inkTangentAt, unchecked_return_type = "{ x: number; y: number }")]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
pub fn ink_tangent_at_js(
    #[wasm_bindgen(unchecked_param_type = "ArrayLike<number>")] xs: &[f64],
    #[wasm_bindgen(unchecked_param_type = "ArrayLike<number>")] ys: &[f64],
    i: u32,
    #[wasm_bindgen(unchecked_param_type = "\"in\" | \"out\"")] side: Option<String>,
) -> JsResult<JsValue> {
    let i = i as usize;
    if i >= xs.len().min(ys.len()) {
        return to_js(&Xy { x: 0.0, y: 0.0 });
    }
    let side = if side.as_deref() == Some("in") {
        Side::In
    } else {
        Side::Out
    };
    let (x, y) = ink_tangent_at(xs, ys, i, side);
    to_js(&Xy { x, y })
}

/// [`ink_curve_at`] as `{ x, y }`. A span past the end gives `{ x: NaN, y: NaN }`,
/// as the TS copy's out-of-range reads do.
///
/// # Errors
///
/// Fails only if the point cannot be converted to a JS value.
#[wasm_bindgen(js_name = inkCurveAt, unchecked_return_type = "{ x: number; y: number }")]
pub fn ink_curve_at_js(
    #[wasm_bindgen(unchecked_param_type = "ArrayLike<number>")] xs: &[f64],
    #[wasm_bindgen(unchecked_param_type = "ArrayLike<number>")] ys: &[f64],
    i: u32,
    u: f64,
) -> JsResult<JsValue> {
    let i = i as usize;
    if i + 1 >= xs.len().min(ys.len()) {
        return to_js(&Xy {
            x: f64::NAN,
            y: f64::NAN,
        });
    }
    let (x, y) = ink_curve_at(xs, ys, i, u);
    to_js(&Xy { x, y })
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

/// [`binomial_smooth`] as a plain array; `passes` defaults to 2.
///
/// # Errors
///
/// Fails only if the values cannot be converted to a JS value.
#[wasm_bindgen(js_name = binomialSmooth, unchecked_return_type = "number[]")]
pub fn binomial_smooth_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] values: &[f64],
    stride: u32,
    passes: Option<f64>,
) -> JsResult<JsValue> {
    to_js(&binomial_smooth(
        values,
        stride as usize,
        js_passes(passes.unwrap_or(2.0)),
    ))
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
#[wasm_bindgen(js_name = smoothInkStroke, unchecked_return_type = "B.PackedInkStroke")]
pub fn smooth_ink_stroke_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] points: &[f64],
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] pressures: &[f64],
    #[wasm_bindgen(unchecked_optional_param_type = "{ spacing?: number; passes?: number }")]
    options: Option<JsValue>,
) -> JsResult<JsValue> {
    let o: SmoothOptions = match options {
        Some(options) if !options.is_undefined() && !options.is_null() => {
            serde_wasm_bindgen::from_value(options)?
        }
        _ => SmoothOptions::default(),
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

/// [`nib_width`]; `velocity` defaults to 0, `options.fullTaper` to the core default.
///
/// # Errors
///
/// Throws as the JS read `options.fullTaper` would on a non-object.
#[wasm_bindgen(js_name = nibWidth)]
pub fn nib_width_js(
    base: f64,
    #[wasm_bindgen(unchecked_optional_param_type = "number")] pressure: Option<f64>,
    #[wasm_bindgen(unchecked_optional_param_type = "number")] velocity: Option<f64>,
    #[wasm_bindgen(unchecked_optional_param_type = "{ fullTaper?: number }")] options: Option<
        JsValue,
    >,
) -> Result<f64, JsValue> {
    let full_taper = match options {
        Some(options) if !options.is_undefined() => {
            let taper = prop(&options, "fullTaper")?;
            (!taper.is_undefined() && !taper.is_null()).then(|| taper.unchecked_into_f64())
        }
        _ => None,
    };
    Ok(nib_width(
        base,
        pressure,
        velocity.unwrap_or(0.0),
        full_taper,
    ))
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

/// [`pack_ink_stroke`] as `{ points, pressures }`; `pressures` defaults to `[]`,
/// `options` is the TS `InkStrokePackerOptions` or undefined.
///
/// # Errors
///
/// Fails if `options` is not an options object.
#[wasm_bindgen(js_name = packInkStroke, unchecked_return_type = "B.PackedInkStroke")]
pub fn pack_ink_stroke_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] points: &[f64],
    #[wasm_bindgen(unchecked_optional_param_type = "readonly number[]")] pressures: Option<
        Vec<f64>,
    >,
    #[wasm_bindgen(unchecked_optional_param_type = "B.InkStrokePackerOptions")] options: Option<
        JsValue,
    >,
) -> JsResult<JsValue> {
    let pressures = pressures.unwrap_or_default();
    let packed = pack_ink_stroke(points, &pressures, packer_options(options)?);
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
pub fn create_ink_stroke_packer(
    #[wasm_bindgen(unchecked_optional_param_type = "B.InkStrokePackerOptions")] options: Option<
        JsValue,
    >,
) -> JsResult<InkStrokePacker> {
    Ok(InkStrokePacker {
        inner: CorePacker::new(packer_options(options)?),
    })
}
/// The `segmentInkLines` options; a missing field takes the default.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SegmentOptions {
    window_ms: Option<f64>,
    band_ratio: Option<f64>,
}

/// [`segment_ink_lines`] over the caller's stroke objects: a page's pen strokes
/// grouped into lines, top to bottom (each line holding the caller's own stroke
/// objects), and the line each input stroke went into (`-1` for none). A stroke
/// whose `tool` is not `"pen"` is skipped; a missing `t0` reads as NaN.
///
/// # Errors
///
/// Throws if a stroke cannot be read or `options` is not an options object.
#[wasm_bindgen(
    js_name = segmentInkLines,
    unchecked_return_type = "{ lines: { strokes: B.InkStroke[]; yBand: [number, number] }[]; lineOfStroke: number[] }"
)]
pub fn segment_ink_lines_js(
    #[wasm_bindgen(unchecked_param_type = "readonly T.ReadonlyInkStroke[]")] strokes: &Array,
    #[wasm_bindgen(unchecked_optional_param_type = "{ windowMs?: number; bandRatio?: number }")]
    options: Option<JsValue>,
) -> Result<JsValue, JsValue> {
    let options: SegmentOptions = match options {
        Some(options) if !options.is_undefined() && !options.is_null() => {
            serde_wasm_bindgen::from_value(options)?
        }
        _ => SegmentOptions::default(),
    };
    let mut segment_strokes = Vec::with_capacity(strokes.length() as usize);
    for stroke in strokes.iter() {
        segment_strokes.push(SegmentStroke {
            points: f64s(&prop(&stroke, "points")?),
            tool: prop(&stroke, "tool")?.as_string().unwrap_or_default(),
            t0: Some(prop(&stroke, "t0")?.unchecked_into_f64()),
        });
    }
    let indices = segment_ink_lines(
        &segment_strokes,
        options.window_ms.unwrap_or(INK_GROUP_WINDOW_MS),
        options.band_ratio.unwrap_or(INK_LINE_BAND_RATIO),
    );
    let lines = Array::new();
    for line in &indices.lines {
        let members = Array::new();
        for &index in &line.stroke_indices {
            let _ = members.push(&strokes.get(index));
        }
        let entry = Object::new();
        set_prop(&entry, "strokes", &members)?;
        set_prop(&entry, "yBand", &pair(line.y_band[0], line.y_band[1]))?;
        let _ = lines.push(&entry);
    }
    let out = Object::new();
    set_prop(&out, "lines", &lines)?;
    set_prop(&out, "lineOfStroke", &to_js(&indices.line_of_stroke)?)?;
    Ok(out.into())
}

/// The stored line records for `counts` strokes per line and flat `yMin, yMax`
/// `bands`; a missing `recognised` reads as `[]`.
fn line_records(counts: &[u32], bands: &[f64], recognised: Option<JsValue>) -> JsResult<JsValue> {
    let recognised: Vec<Option<RecognisedLineText>> = match recognised {
        Some(recognised) if !recognised.is_undefined() && !recognised.is_null() => {
            serde_wasm_bindgen::from_value(recognised)?
        }
        _ => Vec::new(),
    };
    let lines: Vec<(u32, [f64; 2])> = counts
        .iter()
        .zip(bands.as_chunks::<2>().0)
        .map(|(&count, &band)| (count, band))
        .collect();
    to_js(&ink_line_records(&lines, &recognised))
}

/// [`ink_line_records`]: `counts[i]` strokes per line, `bands` as flat
/// `yMin, yMax` pairs, `recognised` an array of `{ text, confidence }` or
/// undefined per line (default `[]`).
///
/// # Errors
///
/// Fails if `recognised` is not such an array.
#[wasm_bindgen(js_name = inkLineRecords, unchecked_return_type = "B.InkLineRecord[]")]
pub fn ink_line_records_js(
    #[wasm_bindgen(unchecked_param_type = "Uint32Array")] counts: &[u32],
    #[wasm_bindgen(unchecked_param_type = "Float64Array")] bands: &[f64],
    #[wasm_bindgen(
        unchecked_optional_param_type = "readonly ({ text: string; confidence: number } | undefined)[]"
    )]
    recognised: Option<JsValue>,
) -> JsResult<JsValue> {
    line_records(counts, bands, recognised)
}

/// Strokes reordered so each line's are contiguous, each a copy tagged with its
/// `lineIndex` (unsegmented ones last, `-1`), and the line records the container
/// stores ([`ink_line_records`]). `segmentation` is what `segmentInkLines` returned.
///
/// # Errors
///
/// Throws if `segmentation` or a stroke cannot be read, or `recognised` is not an
/// array of `{ text, confidence }` or undefined.
#[wasm_bindgen(
    js_name = applyInkSegmentation,
    unchecked_return_type = "{ strokes: B.InkStroke[]; lines: B.InkLineRecord[] }"
)]
pub fn apply_ink_segmentation_js(
    #[wasm_bindgen(unchecked_param_type = "readonly T.ReadonlyInkStroke[]")] strokes: &Array,
    #[wasm_bindgen(
        unchecked_param_type = "{ lines: readonly { strokes: readonly T.ReadonlyInkStroke[]; yBand: readonly [number, number] }[]; lineOfStroke: readonly number[] }"
    )]
    segmentation: &JsValue,
    #[wasm_bindgen(
        unchecked_optional_param_type = "readonly ({ text: string; confidence: number } | undefined)[]"
    )]
    recognised: Option<JsValue>,
) -> Result<JsValue, JsValue> {
    let grouped = Array::new();
    let mut counts = Vec::new();
    let mut bands = Vec::new();
    let lines = Array::from(&prop(segmentation, "lines")?);
    for (line_index, line) in lines.iter().enumerate() {
        let members = Array::from(&prop(&line, "strokes")?);
        for stroke in members.iter() {
            let copy = Object::assign(&Object::new(), stroke.unchecked_ref());
            set_prop(&copy, "lineIndex", &JsValue::from(line_index))?;
            let _ = grouped.push(&copy);
        }
        counts.push(members.length());
        let band = prop(&line, "yBand")?;
        bands.push(Reflect::get_u32(&band, 0)?.unchecked_into_f64());
        bands.push(Reflect::get_u32(&band, 1)?.unchecked_into_f64());
    }
    let line_of_stroke = prop(segmentation, "lineOfStroke")?;
    for (index, stroke) in (0_u32..).zip(strokes.iter()) {
        if Reflect::get_u32(&line_of_stroke, index)?.as_f64() == Some(-1.0) {
            let copy = Object::assign(&Object::new(), stroke.unchecked_ref());
            set_prop(&copy, "lineIndex", &JsValue::from_f64(-1.0))?;
            let _ = grouped.push(&copy);
        }
    }
    let out = Object::new();
    set_prop(&out, "strokes", &grouped)?;
    set_prop(&out, "lines", &line_records(&counts, &bands, recognised)?)?;
    Ok(out.into())
}

/// [`is_unsure_confidence`].
#[wasm_bindgen(js_name = isUnsureConfidence)]
#[must_use]
pub fn is_unsure_confidence_js(conf: f64) -> bool {
    is_unsure_confidence(conf)
}

/// Whether a line's `conf` is too low, or missing, to trust ([`is_unsure_confidence`]).
///
/// # Errors
///
/// Throws as the JS read `line.conf` would on a non-object.
#[wasm_bindgen(js_name = isUnsureLine)]
pub fn is_unsure_line_js(
    #[wasm_bindgen(unchecked_param_type = "{ conf: number }")] line: &JsValue,
) -> Result<bool, JsValue> {
    Ok(is_unsure_confidence(
        prop(line, "conf")?.unchecked_into_f64(),
    ))
}

/// [`map_ink_confidence`]; `scale` defaults to 1.
#[wasm_bindgen(js_name = mapInkConfidence)]
#[must_use]
pub fn map_ink_confidence_js(raw: f64, scale: Option<f64>) -> f64 {
    map_ink_confidence(raw, scale.unwrap_or(1.0))
}

/// [`ink_page_confidence`] over the lines' `conf` values.
///
/// # Errors
///
/// Throws as the JS read `line.conf` would on a non-object line.
#[wasm_bindgen(js_name = inkPageConfidence)]
pub fn ink_page_confidence_js(
    #[wasm_bindgen(unchecked_param_type = "readonly { conf: number }[]")] lines: &Array,
) -> Result<f64, JsValue> {
    let mut confs = Vec::with_capacity(lines.length() as usize);
    for line in lines.iter() {
        confs.push(prop(&line, "conf")?.unchecked_into_f64());
    }
    Ok(ink_page_confidence(&confs))
}

/// [`INK_UNSURE_CONFIDENCE`], read at call time.
#[wasm_bindgen(js_name = inkUnsureConfidence)]
#[must_use]
pub fn ink_unsure_confidence_js() -> f64 {
    INK_UNSURE_CONFIDENCE
}

/// [`bands_coincide`] for two `[start, end]` y-bands (a missing end reads as NaN).
#[wasm_bindgen(js_name = bandsCoincide)]
#[must_use]
pub fn bands_coincide_js(
    #[wasm_bindgen(unchecked_param_type = "readonly [number, number]")] a: &[f64],
    #[wasm_bindgen(unchecked_param_type = "readonly [number, number]")] b: &[f64],
) -> bool {
    let at = |band: &[f64], i: usize| band.get(i).copied().unwrap_or(f64::NAN);
    bands_coincide((at(a, 0), at(a, 1)), (at(b, 0), at(b, 1)))
}

/// [`band_union`](wf_core::ink::recognise::band_union) over flat `start, end` pairs: the
/// spanning `[start, end]`, or `null` when there are none.
#[wasm_bindgen(js_name = inkBandUnion, unchecked_return_type = "[number, number] | null")]
#[must_use]
pub fn ink_band_union_js(
    #[wasm_bindgen(unchecked_param_type = "Float64Array")] bands: &[f64],
) -> JsValue {
    wf_core::ink::recognise::band_union(bands)
        .map_or(JsValue::NULL, |(start, end)| pair(start, end))
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
#[wasm_bindgen(js_name = inkPageSummary, unchecked_return_type = "{ text: string; confidence: number; unsure: number }")]
pub fn ink_page_summary_js(
    #[wasm_bindgen(unchecked_param_type = "readonly { text: string; conf: number }[]")]
    lines: JsValue,
) -> JsResult<JsValue> {
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
#[wasm_bindgen(js_name = decodeInkWords, unchecked_return_type = "{ text: string; conf: number; alternatives?: string[] }")]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
pub fn decode_ink_words_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly { candidates: readonly string[]; known?: readonly boolean[] | null; join?: string | null }[]"
    )]
    words: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] vocabulary: JsValue,
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

/// [`ink_vocabulary_words`](wf_core::ink::decode::ink_vocabulary_words), sorted.
fn sorted_vocabulary_words(vocabulary: JsValue) -> JsResult<Vec<String>> {
    let vocabulary: Vec<String> = serde_wasm_bindgen::from_value(vocabulary)?;
    let mut words: Vec<String> = wf_core::ink::decode::ink_vocabulary_words(&vocabulary)
        .into_iter()
        .collect();
    words.sort_unstable();
    Ok(words)
}

/// The words a recogniser vocabulary allows, in order
/// ([`ink_vocabulary_words`](wf_core::ink::decode::ink_vocabulary_words), sorted).
///
/// # Errors
///
/// Fails if `vocabulary` is not an array of strings.
#[wasm_bindgen(js_name = inkVocabularyWordList, unchecked_return_type = "string[]")]
pub fn ink_vocabulary_word_list_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] vocabulary: JsValue,
) -> JsResult<JsValue> {
    to_js(&sorted_vocabulary_words(vocabulary)?)
}

/// The words a recogniser vocabulary allows, as a `Set` (in sorted insertion order).
///
/// # Errors
///
/// Fails if `vocabulary` is not an array of strings.
#[wasm_bindgen(js_name = inkVocabularyWords, unchecked_return_type = "Set<string>")]
pub fn ink_vocabulary_words_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] vocabulary: JsValue,
) -> JsResult<js_sys::Set> {
    Ok(js_sys::Set::new(&to_js(&sorted_vocabulary_words(
        vocabulary,
    )?)?))
}

/// [`ink_stroke_band`](wf_core::ink::segment::ink_stroke_band): `[yMin, yMax]` over a
/// stroke's flat x,y points, or `undefined` when no y is finite.
#[wasm_bindgen(js_name = inkStrokeBandOf)]
#[must_use]
pub fn ink_stroke_band_js(points: &[f64]) -> Option<Vec<f64>> {
    wf_core::ink::segment::ink_stroke_band(points).map(|(lo, hi)| vec![lo, hi])
}

/// The y band `[min, max]` of a stroke's points, or `null` for a stroke with no
/// finite y ([`ink_stroke_band`](wf_core::ink::segment::ink_stroke_band)).
///
/// # Errors
///
/// Throws as the JS read `stroke.points` would on a non-object.
#[wasm_bindgen(js_name = inkStrokeBand, unchecked_return_type = "[number, number] | null")]
pub fn ink_stroke_band_of_stroke_js(
    #[wasm_bindgen(unchecked_param_type = "{ points: ArrayLike<number> }")] stroke: &JsValue,
) -> Result<JsValue, JsValue> {
    let points = f64s(&prop(stroke, "points")?);
    Ok(wf_core::ink::segment::ink_stroke_band(&points)
        .map_or(JsValue::NULL, |(lo, hi)| pair(lo, hi)))
}

/// Fit a line, rect, ellipse or arrow to a finished mark (Rust `snap_ink_shape`).
/// `null` when the recogniser abstains.
#[wasm_bindgen(js_name = snapInkShape, unchecked_return_type = "{ points: number[]; shape: Exclude<B.InkShape, \"none\"> } | null")]
pub fn snap_ink_shape_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] points: &[f64],
) -> JsResult<JsValue> {
    snap_ink_shape(points).map_or(Ok(JsValue::NULL), |snapped| to_js(&snapped))
}
