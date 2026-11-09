//! Where a page background sits on the A4 sheet: a port of `placeOnSheet` in
//! `apps/web/src/features/ink/application/page-background.ts`.

use serde::Serialize;

use super::ink_page::{INK_A4_HEIGHT, INK_A4_WIDTH};
use super::js_math;

/// The sheet's raster width: A4 at 200 dpi.
pub const A4_RASTER_WIDTH: f64 = 1654.0;

/// The sheet's raster height: A4 at 200 dpi, from the width and the A4 ratio.
#[must_use]
pub fn a4_raster_height() -> f64 {
    js_math::round(A4_RASTER_WIDTH * INK_A4_HEIGHT / INK_A4_WIDTH)
}

/// Where a background is drawn on the sheet.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Placement {
    /// Left edge on the sheet, in pixels.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub x: f64,
    /// Top edge on the sheet, in pixels.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub y: f64,
    /// Drawn width, in pixels.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub width: f64,
    /// Drawn height, in pixels.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub height: f64,
}

/// Where a `source_width × source_height` image sits on a `sheet_width ×
/// sheet_height` sheet: as large as fits without cropping, centred on the axis
/// it does not fill. A source that fits already is scaled up to the sheet,
/// since a background is meant to cover the page.
#[must_use]
pub fn place_on_sheet(
    source_width: f64,
    source_height: f64,
    sheet_width: f64,
    sheet_height: f64,
) -> Placement {
    let w = js_math::max(1.0, source_width);
    let h = js_math::max(1.0, source_height);
    let scale = js_math::min(sheet_width / w, sheet_height / h);
    let width = js_math::round(w * scale);
    let height = js_math::round(h * scale);
    Placement {
        x: js_math::round((sheet_width - width) / 2.0),
        y: js_math::round((sheet_height - height) / 2.0),
        width,
        height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sheet_is_a4_at_200_dpi() {
        assert_eq!(A4_RASTER_WIDTH, 1654.0);
        assert_eq!(a4_raster_height(), 2339.0);
    }

    #[test]
    fn a4_source_fills_the_sheet() {
        let sheet_h = a4_raster_height();
        assert_eq!(
            place_on_sheet(2100.0, 2970.0, A4_RASTER_WIDTH, sheet_h),
            Placement {
                x: 0.0,
                y: 0.0,
                width: 1654.0,
                height: 2339.0
            }
        );
    }

    #[test]
    fn a_wide_source_is_centred_vertically() {
        let sheet_h = a4_raster_height();
        let b = place_on_sheet(1600.0, 800.0, A4_RASTER_WIDTH, sheet_h);
        assert_eq!(b.width, A4_RASTER_WIDTH);
        assert_eq!(b.height, 827.0);
        assert_eq!(b.x, 0.0);
        assert_eq!(b.y, js_math::round((sheet_h - 827.0) / 2.0));
    }

    #[test]
    fn a_tall_source_is_centred_horizontally() {
        let sheet_h = a4_raster_height();
        let b = place_on_sheet(100.0, 1000.0, A4_RASTER_WIDTH, sheet_h);
        assert_eq!(b.height, sheet_h);
        assert_eq!(b.width, 234.0);
        assert_eq!(b.x, js_math::round((A4_RASTER_WIDTH - 234.0) / 2.0));
    }

    #[test]
    fn a_small_source_is_enlarged_to_the_sheet() {
        let b = place_on_sheet(210.0, 297.0, A4_RASTER_WIDTH, a4_raster_height());
        assert_eq!(b.width, A4_RASTER_WIDTH);
    }
}
