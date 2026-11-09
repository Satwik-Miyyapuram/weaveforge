//! Ink geometry: smoothing, curves, nib widths, zoom and the live stroke
//! packer. A faithful port of `packages/core/src/ink`.

// A port of JS number code: `!(x > 0.0)` keeps the TS NaN handling, and index
// casts mirror JS numbers used as indices, all bounded by slice lengths.
#![allow(
    clippy::neg_cmp_op_on_partial_ord,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss,
    clippy::cast_lossless
)]

pub mod curve;
pub mod decode;
pub mod ink_engine;
pub mod ink_page;
pub mod ink_paths;
pub mod js_math;
pub mod recognise;
pub mod segment;
pub mod smooth;
pub mod stroke_packer;
pub mod width;
pub mod zoom;

/// Coordinate bound in 0.1 mm: the container stores coordinates as `Int16`.
pub const INK_COORD_LIMIT: f64 = 32767.0;
/// Points per stroke: the container stores a stroke's length as a `Uint16`.
pub const INK_STROKE_MAX_POINTS: f64 = 65_535.0;
/// Distance, in 0.1 mm, a packed stroke may stray from the drawn one.
pub const INK_PACK_TOLERANCE: f64 = 1.2;
/// Pressure deviation, out of 255, that keeps a point the centreline does not need.
pub const INK_PACK_PRESSURE_TOLERANCE: f64 = 20.0;

/// A pressure as the byte the container stores; missing or non-finite is 0.
#[must_use]
pub fn pressure_byte(pressure: Option<f64>) -> f64 {
    match pressure {
        Some(p) if p.is_finite() => js_math::max(0.0, js_math::min(255.0, js_math::round(p))),
        _ => 0.0,
    }
}

/// One stroke ready for storage: flat x,y pairs and one pressure byte per point.
/// The smoothing functions return this shape too.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PackedInkStroke {
    /// Flat x,y pairs in 0.1 mm.
    pub points: Vec<f64>,
    /// One 0-255 pressure byte per point.
    pub pressures: Vec<f64>,
}
