//! Reader viewport math, PDF page projection and annotation sort keys. A faithful port of
//! packages/core/src/reader/reader-viewport.ts, page-projection.ts and sort-index.ts.
//!
//! Stays in TS: nothing here. All three TS modules are pure data-in, data-out.

// A port of JS number code: `Number.isFinite` and `Math.min/max` semantics are
// kept exactly, and float equality mirrors JS `===` on the rotation values.
#![allow(clippy::float_cmp)]

use crate::ink::js_math;
use crate::sync::frontmatter::js_number;
use serde::{Deserialize, Serialize};

/// Default zoom when the container size is unknown.
const READER_DEFAULT_SCALE: f64 = 1.0;
/// `READER_MIN_SCALE` in the TS copy.
const READER_MIN_SCALE: f64 = 0.25;
/// `READER_MAX_SCALE` in the TS copy.
const READER_MAX_SCALE: f64 = 4.0;
/// `READER_ZOOM_STEP` in the TS copy.
#[cfg(test)]
const READER_ZOOM_STEP: f64 = 1.25;
/// The default `gutterPx` of the fit functions in the TS copy.
const READER_GUTTER_PX: f64 = 24.0;
/// `Number.MAX_SAFE_INTEGER` in JS.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// How the reader sizes the page. Mirrors `ReaderFitMode` in the TS copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum ReaderFitMode {
    /// Fill the container width.
    Width,
    /// Fit the whole page in the container.
    Page,
    /// Use the stored scale.
    Custom,
}

/// PDF page size in user-space units. Mirrors `ReaderPageSize` in the TS copy.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReaderPageSize {
    /// Page width.
    pub width: f64,
    /// Page height.
    pub height: f64,
}

/// Container size in CSS pixels. Mirrors `ReaderContainerSize` in the TS copy.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReaderContainerSize {
    /// Container width.
    pub width: f64,
    /// Container height.
    pub height: f64,
}

/// The viewport state. Mirrors `ReaderViewportState` in the TS copy.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReaderViewportState {
    /// Stored zoom scale.
    pub scale: f64,
    /// Fit mode.
    pub fit: ReaderFitMode,
    /// Rotation in degrees.
    pub rotation: f64,
    /// 1-based current page.
    pub page: f64,
}

/// The fields `resolve_viewport_scale` reads. Mirrors the `Pick` in the TS copy.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReaderViewportScaleState {
    /// Stored zoom scale.
    pub scale: f64,
    /// Fit mode.
    pub fit: ReaderFitMode,
    /// Rotation in degrees.
    pub rotation: f64,
}

/// Input to the page projection. Mirrors `PageProjection` in the TS copy.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReaderPageProjection {
    /// Unrotated page width in PDF user-space units.
    pub page_width: f64,
    /// Unrotated page height in PDF user-space units.
    pub page_height: f64,
    /// Render scale.
    pub scale: f64,
    /// Rotation in degrees; other values are normalised.
    pub rotation: f64,
}

/// A point in CSS pixels. Mirrors the `{ x, y }` returned by the TS projection functions.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReaderScreenPoint {
    /// Horizontal position.
    pub x: f64,
    /// Vertical position.
    pub y: f64,
}

/// A box in CSS pixels. Mirrors the object `pdfRectToScreenBox` returns.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReaderScreenBox {
    /// Left edge.
    pub left: f64,
    /// Top edge.
    pub top: f64,
    /// Width.
    pub width: f64,
    /// Height.
    pub height: f64,
}

/// `clampScale`: a non-finite or non-positive scale gives 1, else clamps to the zoom range.
#[must_use]
pub fn clamp_scale(scale: f64) -> f64 {
    if !scale.is_finite() || scale <= 0.0 {
        return READER_DEFAULT_SCALE;
    }
    js_math::min(READER_MAX_SCALE, js_math::max(READER_MIN_SCALE, scale))
}

/// `computeFitWidthScale`: scale that fills the container width minus `gutter_px`.
#[must_use]
pub fn compute_fit_width_scale(
    page: ReaderPageSize,
    container: ReaderContainerSize,
    rotation: f64,
    gutter_px: f64,
) -> f64 {
    let visual = visual_page_size(page, rotation);
    let available = js_math::max(1.0, container.width - gutter_px);
    clamp_scale(available / js_math::max(1.0, visual.width))
}

/// `computeFitPageScale`: scale at which the whole page fits the container.
#[must_use]
pub fn compute_fit_page_scale(
    page: ReaderPageSize,
    container: ReaderContainerSize,
    rotation: f64,
    gutter_px: f64,
) -> f64 {
    let visual = visual_page_size(page, rotation);
    let available_w = js_math::max(1.0, container.width - gutter_px);
    let available_h = js_math::max(1.0, container.height - gutter_px);
    let by_w = available_w / js_math::max(1.0, visual.width);
    let by_h = available_h / js_math::max(1.0, visual.height);
    clamp_scale(js_math::min(by_w, by_h))
}

/// `visualPageSize`: the page size with the axes swapped at 90 and 270.
#[must_use]
pub fn visual_page_size(page: ReaderPageSize, rotation: f64) -> ReaderPageSize {
    if rotation == 90.0 || rotation == 270.0 {
        ReaderPageSize {
            width: page.height,
            height: page.width,
        }
    } else {
        page
    }
}

/// `clampZoomFactor`: keeps `base_scale * factor` inside the zoom range. A base
/// scale that is not a positive finite number gives 1.
#[must_use]
pub fn clamp_zoom_factor(factor: f64, base_scale: f64) -> f64 {
    if !base_scale.is_finite() || base_scale <= 0.0 {
        return 1.0;
    }
    js_math::min(
        READER_MAX_SCALE / base_scale,
        js_math::max(READER_MIN_SCALE / base_scale, factor),
    )
}

/// `zoomIn`: multiply by `step` and clamp.
#[must_use]
pub fn zoom_in(scale: f64, step: f64) -> f64 {
    clamp_scale(scale * step)
}

/// `zoomOut`: divide by `step` and clamp.
#[must_use]
pub fn zoom_out(scale: f64, step: f64) -> f64 {
    clamp_scale(scale / step)
}

/// `nextRotation`: add `delta` (90 or -90) and wrap into [0, 360).
#[must_use]
pub fn next_rotation(current: f64, delta: f64) -> f64 {
    (((current + delta) % 360.0) + 360.0) % 360.0
}

/// `clampPage`: a 1-based page number clamped into [1, num_pages].
#[must_use]
pub fn clamp_page(page: f64, num_pages: f64) -> f64 {
    if !num_pages.is_finite() || num_pages < 1.0 {
        return 1.0;
    }
    if !page.is_finite() {
        return 1.0;
    }
    js_math::min(num_pages, js_math::max(1.0, js_math::round(page)))
}

/// `resolveViewportScale`: the effective render scale for the fit mode.
#[must_use]
pub fn resolve_viewport_scale(
    state: ReaderViewportScaleState,
    page: ReaderPageSize,
    container: ReaderContainerSize,
) -> f64 {
    match state.fit {
        ReaderFitMode::Width => {
            compute_fit_width_scale(page, container, state.rotation, READER_GUTTER_PX)
        }
        ReaderFitMode::Page => {
            compute_fit_page_scale(page, container, state.rotation, READER_GUTTER_PX)
        }
        ReaderFitMode::Custom => clamp_scale(state.scale),
    }
}

/// `initialReaderViewport`: fit-width, rotation 0, scale 1, on the clamped page.
#[must_use]
pub fn initial_reader_viewport(page: f64) -> ReaderViewportState {
    ReaderViewportState {
        scale: READER_DEFAULT_SCALE,
        fit: ReaderFitMode::Width,
        rotation: 0.0,
        page: clamp_page(page, MAX_SAFE_INTEGER),
    }
}

/// `normalisePageRotation`: folds any rotation onto 0, 90, 180 or 270 (anything else gives 0).
#[must_use]
pub fn normalise_page_rotation(rotation: f64) -> f64 {
    let r = (((js_math::round(rotation / 90.0) * 90.0) % 360.0) + 360.0) % 360.0;
    if r == 90.0 || r == 180.0 || r == 270.0 {
        r
    } else {
        0.0
    }
}

/// `projectedPageSize`: rendered page size in CSS pixels, axes swapped on a quarter turn.
#[must_use]
pub fn projected_page_size(p: ReaderPageProjection) -> ReaderPageSize {
    let rotation = normalise_page_rotation(p.rotation);
    let swapped = rotation == 90.0 || rotation == 270.0;
    let (w, h) = if swapped {
        (p.page_height, p.page_width)
    } else {
        (p.page_width, p.page_height)
    };
    ReaderPageSize {
        width: w * p.scale,
        height: h * p.scale,
    }
}

/// `pdfPointToScreen`: a PDF user-space point to CSS pixels in the rendered page box.
#[must_use]
pub fn pdf_point_to_screen(x: f64, y: f64, p: ReaderPageProjection) -> ReaderScreenPoint {
    let scale = p.scale;
    let rotation = normalise_page_rotation(p.rotation);
    if rotation == 90.0 {
        ReaderScreenPoint {
            x: y * scale,
            y: x * scale,
        }
    } else if rotation == 180.0 {
        ReaderScreenPoint {
            x: (p.page_width - x) * scale,
            y: y * scale,
        }
    } else if rotation == 270.0 {
        ReaderScreenPoint {
            x: (p.page_height - y) * scale,
            y: (p.page_width - x) * scale,
        }
    } else {
        ReaderScreenPoint {
            x: x * scale,
            y: (p.page_height - y) * scale,
        }
    }
}

/// `screenPointToPdf`: CSS pixels in the rendered page box to a PDF user-space point.
#[must_use]
pub fn screen_point_to_pdf(sx: f64, sy: f64, p: ReaderPageProjection) -> ReaderScreenPoint {
    let scale = p.scale;
    let x = sx / scale;
    let y = sy / scale;
    let rotation = normalise_page_rotation(p.rotation);
    if rotation == 90.0 {
        ReaderScreenPoint { x: y, y: x }
    } else if rotation == 180.0 {
        ReaderScreenPoint {
            x: p.page_width - x,
            y,
        }
    } else if rotation == 270.0 {
        ReaderScreenPoint {
            x: p.page_width - y,
            y: p.page_height - x,
        }
    } else {
        ReaderScreenPoint {
            x,
            y: p.page_height - y,
        }
    }
}

/// `pdfRectToScreenBox`: a PDF `[x1, y1, x2, y2]` rect as a screen box, corners re-normalised.
#[must_use]
pub fn pdf_rect_to_screen_box(rect: [f64; 4], p: ReaderPageProjection) -> ReaderScreenBox {
    let a = pdf_point_to_screen(rect[0], rect[1], p);
    let b = pdf_point_to_screen(rect[2], rect[3], p);
    ReaderScreenBox {
        left: js_math::min(a.x, b.x),
        top: js_math::min(a.y, b.y),
        width: (b.x - a.x).abs(),
        height: (b.y - a.y).abs(),
    }
}

/// `buildAnnotationSortIndex`: Zotero's zero-padded `page|offset|top` sort key.
#[must_use]
pub fn build_annotation_sort_index(
    page_index: f64,
    char_offset: f64,
    top_pdf_units: f64,
) -> String {
    let page = js_math::max(0.0, page_index.floor());
    let offset = js_math::max(0.0, char_offset.floor());
    let top = js_math::max(0.0, top_pdf_units.floor());
    format!(
        "{}|{}|{}",
        pad_start(&js_number(page), 5),
        pad_start(&js_number(offset), 6),
        pad_start(&js_number(top), 5),
    )
}

/// JS `String.prototype.padStart(width, "0")` for ASCII text.
fn pad_start(text: &str, width: usize) -> String {
    let len = text.len();
    if len >= width {
        text.to_owned()
    } else {
        format!("{}{text}", "0".repeat(width - len))
    }
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;

    fn proj(rotation: f64) -> ReaderPageProjection {
        ReaderPageProjection {
            page_width: 600.0,
            page_height: 800.0,
            scale: 1.0,
            rotation,
        }
    }

    fn size(width: f64, height: f64) -> ReaderPageSize {
        ReaderPageSize { width, height }
    }

    fn container(width: f64, height: f64) -> ReaderContainerSize {
        ReaderContainerSize { width, height }
    }

    fn pt(x: f64, y: f64) -> ReaderScreenPoint {
        ReaderScreenPoint { x, y }
    }

    #[test]
    fn clamp_scale_rejects_non_finite_and_zero_then_clamps_to_range() {
        assert_eq!(clamp_scale(f64::NAN), 1.0);
        assert_eq!(clamp_scale(0.0), 1.0);
        assert_eq!(clamp_scale(-2.0), 1.0);
        assert_eq!(clamp_scale(0.1), READER_MIN_SCALE);
        assert_eq!(clamp_scale(99.0), READER_MAX_SCALE);
        assert_eq!(clamp_scale(1.5), 1.5);
        assert_eq!(clamp_scale(f64::INFINITY), 1.0);
        assert_eq!(clamp_scale(f64::NEG_INFINITY), 1.0);
    }

    #[test]
    fn compute_fit_width_scale_fills_container_width_with_gutter() {
        let scale = compute_fit_width_scale(size(600.0, 800.0), container(624.0, 900.0), 0.0, 24.0);
        assert_eq!(scale, 1.0);
    }

    #[test]
    fn compute_fit_width_scale_uses_rotated_visual_width() {
        let scale =
            compute_fit_width_scale(size(600.0, 800.0), container(824.0, 900.0), 90.0, 24.0);
        assert_eq!(scale, 1.0);
    }

    #[test]
    fn compute_fit_page_scale_picks_the_tighter_axis() {
        let scale = compute_fit_page_scale(size(600.0, 800.0), container(324.0, 424.0), 0.0, 24.0);
        assert_eq!(scale, 0.5);
    }

    #[test]
    fn compute_fit_page_scale_is_limited_by_height_when_the_pane_is_short() {
        let scale = compute_fit_page_scale(size(600.0, 800.0), container(1224.0, 224.0), 0.0, 24.0);
        assert_eq!(scale, 0.25);
    }

    #[test]
    fn visual_page_size_swaps_axes_at_90_and_270() {
        let page = size(100.0, 200.0);
        assert_eq!(visual_page_size(page, 0.0), page);
        assert_eq!(visual_page_size(page, 180.0), page);
        assert_eq!(visual_page_size(page, 90.0), size(200.0, 100.0));
        assert_eq!(visual_page_size(page, 270.0), size(200.0, 100.0));
    }

    #[test]
    fn zoom_in_and_zoom_out_step_and_clamp() {
        assert_eq!(zoom_in(1.0, READER_ZOOM_STEP), 1.25);
        assert_eq!(zoom_out(1.25, READER_ZOOM_STEP), 1.0);
        assert_eq!(
            zoom_out(READER_MIN_SCALE, READER_ZOOM_STEP),
            READER_MIN_SCALE
        );
        assert_eq!(
            zoom_in(READER_MAX_SCALE, READER_ZOOM_STEP),
            READER_MAX_SCALE
        );
    }

    #[test]
    fn next_rotation_wraps_through_the_four_cardinals() {
        assert_eq!(next_rotation(0.0, 90.0), 90.0);
        assert_eq!(next_rotation(90.0, 90.0), 180.0);
        assert_eq!(next_rotation(180.0, 90.0), 270.0);
        assert_eq!(next_rotation(270.0, 90.0), 0.0);
        assert_eq!(next_rotation(0.0, -90.0), 270.0);
        assert_eq!(next_rotation(90.0, -90.0), 0.0);
    }

    #[test]
    fn clamp_page_is_1_based_and_inclusive_of_num_pages() {
        assert_eq!(clamp_page(0.0, 10.0), 1.0);
        assert_eq!(clamp_page(1.4, 10.0), 1.0);
        assert_eq!(clamp_page(1.6, 10.0), 2.0);
        assert_eq!(clamp_page(99.0, 10.0), 10.0);
        assert_eq!(clamp_page(5.0, 0.0), 1.0);
        assert_eq!(clamp_page(f64::NAN, 10.0), 1.0);
    }

    #[test]
    fn resolve_viewport_scale_respects_fit_modes() {
        let page = size(500.0, 700.0);
        let c = container(524.0, 724.0);
        let state = |fit, scale| ReaderViewportScaleState {
            scale,
            fit,
            rotation: 0.0,
        };
        assert_eq!(
            resolve_viewport_scale(state(ReaderFitMode::Width, 2.0), page, c),
            1.0
        );
        assert_eq!(
            resolve_viewport_scale(state(ReaderFitMode::Page, 2.0), page, c),
            1.0
        );
        assert_eq!(
            resolve_viewport_scale(state(ReaderFitMode::Custom, 2.0), page, c),
            2.0
        );
    }

    #[test]
    fn initial_reader_viewport_defaults_to_fit_width() {
        let state = initial_reader_viewport(3.0);
        assert_eq!(state.fit, ReaderFitMode::Width);
        assert_eq!(state.rotation, 0.0);
        assert_eq!(state.page, 3.0);
        assert_eq!(state.scale, 1.0);
    }

    #[test]
    fn clamp_zoom_factor_keeps_a_gesture_factor_within_the_scale_limits() {
        assert_eq!(clamp_zoom_factor(1.5, 1.0), 1.5);
        assert_eq!(clamp_zoom_factor(10.0, 2.0), READER_MAX_SCALE / 2.0);
        assert_eq!(clamp_zoom_factor(0.01, 1.0), READER_MIN_SCALE);
        assert_eq!(clamp_zoom_factor(1.0, READER_MAX_SCALE), 1.0);
        assert_eq!(clamp_zoom_factor(2.0, READER_MAX_SCALE), 1.0);
        for bad in [0.0, -1.0, f64::NAN] {
            assert_eq!(clamp_zoom_factor(2.0, bad), 1.0);
        }
    }

    #[test]
    fn normalise_page_rotation_folds_anything_onto_the_four_quarter_turns() {
        assert_eq!(normalise_page_rotation(0.0), 0.0);
        assert_eq!(normalise_page_rotation(360.0), 0.0);
        assert_eq!(normalise_page_rotation(-90.0), 270.0);
        assert_eq!(normalise_page_rotation(450.0), 90.0);
        assert_eq!(normalise_page_rotation(f64::NAN), 0.0);
        assert_eq!(normalise_page_rotation(f64::INFINITY), 0.0);
        // JS Math.round rounds halves up, so 45 lands on 90 and 44 on 0.
        assert_eq!(normalise_page_rotation(45.0), 90.0);
        assert_eq!(normalise_page_rotation(44.0), 0.0);
    }

    #[test]
    fn projected_page_size_swaps_the_axes_on_a_quarter_turn() {
        let size_at = |rotation| projected_page_size(proj(rotation));
        assert_eq!(size_at(0.0), size(600.0, 800.0));
        assert_eq!(size_at(90.0), size(800.0, 600.0));
        assert_eq!(size_at(180.0), size(600.0, 800.0));
        assert_eq!(size_at(270.0), size(800.0, 600.0));
    }

    #[test]
    fn pdf_point_to_screen_flips_the_origin_at_0_degrees() {
        assert_eq!(pdf_point_to_screen(0.0, 0.0, proj(0.0)), pt(0.0, 800.0));
        assert_eq!(pdf_point_to_screen(0.0, 800.0, proj(0.0)), pt(0.0, 0.0));
    }

    #[test]
    fn pdf_point_to_screen_keeps_a_page_corner_in_the_page_box_at_every_rotation() {
        let corners = [(0.0, 0.0), (600.0, 0.0), (0.0, 800.0), (600.0, 800.0)];
        for rotation in [0.0, 90.0, 180.0, 270.0] {
            let projection = proj(rotation);
            let s = projected_page_size(projection);
            for (x, y) in corners {
                let p = pdf_point_to_screen(x, y, projection);
                assert!(p.x >= -1e-6 && p.x <= s.width + 1e-6, "x at {rotation}");
                assert!(p.y >= -1e-6 && p.y <= s.height + 1e-6, "y at {rotation}");
            }
        }
    }

    #[test]
    fn screen_point_to_pdf_inverts_pdf_point_to_screen_at_every_rotation_and_scale() {
        for rotation in [0.0, 90.0, 180.0, 270.0] {
            for scale in [1.0, 1.75] {
                let projection = ReaderPageProjection {
                    scale,
                    ..proj(rotation)
                };
                for (x, y) in [(10.0, 20.0), (599.0, 799.0), (300.0, 400.0)] {
                    let screen = pdf_point_to_screen(x, y, projection);
                    let back = screen_point_to_pdf(screen.x, screen.y, projection);
                    assert!((back.x - x).abs() < 1e-9 && (back.y - y).abs() < 1e-9);
                }
            }
        }
    }

    #[test]
    fn pdf_rect_to_screen_box_normalises_corners_that_rotation_swapped() {
        let b = pdf_rect_to_screen_box([100.0, 700.0, 300.0, 750.0], proj(90.0));
        assert!(b.width > 0.0 && b.height > 0.0);
        assert_eq!(
            b,
            ReaderScreenBox {
                left: 700.0,
                top: 100.0,
                width: 50.0,
                height: 200.0,
            }
        );
    }

    #[test]
    fn scale_multiplies_through_the_projection() {
        let projection = ReaderPageProjection {
            scale: 2.0,
            ..proj(0.0)
        };
        assert_eq!(pdf_point_to_screen(10.0, 800.0, projection), pt(20.0, 0.0));
    }

    #[test]
    fn build_annotation_sort_index_matches_zotero_zero_padded_shape() {
        assert_eq!(
            build_annotation_sort_index(8.0, 412.0, 574.9),
            "00008|000412|00574"
        );
        assert_eq!(
            build_annotation_sort_index(0.0, 0.0, 0.0),
            "00000|000000|00000"
        );
    }

    #[test]
    fn build_annotation_sort_index_sorts_lexically_in_reading_order() {
        let mut keys = vec![
            build_annotation_sort_index(1.0, 10.0, 100.0),
            build_annotation_sort_index(0.0, 999.0, 50.0),
            build_annotation_sort_index(1.0, 2.0, 200.0),
        ];
        keys.sort();
        assert_eq!(
            keys,
            vec![
                build_annotation_sort_index(0.0, 999.0, 50.0),
                build_annotation_sort_index(1.0, 2.0, 200.0),
                build_annotation_sort_index(1.0, 10.0, 100.0),
            ]
        );
    }

    #[test]
    fn build_annotation_sort_index_handles_non_finite_and_negative_like_js() {
        assert_eq!(
            build_annotation_sort_index(-3.0, -1.0, -0.5),
            "00000|000000|00000"
        );
        assert_eq!(
            build_annotation_sort_index(f64::NAN, 0.0, 0.0),
            "00NaN|000000|00000"
        );
        assert_eq!(
            build_annotation_sort_index(0.0, f64::INFINITY, 0.0),
            "00000|Infinity|00000"
        );
        assert_eq!(
            build_annotation_sort_index(1e21, 0.0, 0.0),
            "1e+21|000000|00000"
        );
    }
}
