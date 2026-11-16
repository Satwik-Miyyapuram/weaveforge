//! The WebGL scissor box for a page. A port of `pageScissor` in
//! `apps/web/src/features/ink/render/webgl-support.ts`.

use super::js_math;

/// The page's box on a drawing surface of `width` by `height` device pixels, as
/// `gl.scissor`'s `[x, y, width, height]`: GL counts rows from the foot.
///
/// `view` is `(scale, offset_x, offset_y)` in CSS pixels, `dpr` the device pixel
/// ratio, `page` the page's `(width, height)` in CSS pixels at scale 1, and
/// `surface` the drawing surface's `(width, height)` in device pixels. The box is
/// clipped to the surface.
#[must_use]
pub fn page_scissor(
    view: (f64, f64, f64),
    dpr: f64,
    page: (f64, f64),
    surface: (f64, f64),
) -> [f64; 4] {
    let (scale, offset_x, offset_y) = view;
    let (page_width, page_height) = page;
    let (width, height) = surface;
    let k = scale * dpr;
    let left = js_math::max(0.0, (offset_x * dpr).floor());
    let top = js_math::max(0.0, (offset_y * dpr).floor());
    let right = js_math::min(width, (offset_x * dpr + page_width * k).ceil());
    let bottom = js_math::min(height, (offset_y * dpr + page_height * k).ceil());
    [
        left,
        height - js_math::max(top, bottom),
        js_math::max(0.0, right - left),
        js_math::max(0.0, bottom - top),
    ]
}

#[cfg(test)]
mod tests {
    use super::page_scissor;

    #[test]
    fn a_page_inside_the_surface_is_its_own_box_counted_from_the_foot() {
        // Page 100 x 50 at the origin on a 200 x 100 surface: top half of GL rows.
        assert_eq!(
            page_scissor((1.0, 0.0, 0.0), 1.0, (100.0, 50.0), (200.0, 100.0)),
            [0.0, 50.0, 100.0, 50.0]
        );
    }

    #[test]
    fn a_page_past_the_surface_is_clipped_to_it() {
        assert_eq!(
            page_scissor((1.0, 0.0, 0.0), 1.0, (100.0, 50.0), (60.0, 40.0)),
            [0.0, 0.0, 60.0, 40.0]
        );
    }

    #[test]
    fn a_page_panned_off_the_left_edge_starts_at_zero() {
        assert_eq!(
            page_scissor((1.0, -10.0, 0.0), 1.0, (100.0, 50.0), (200.0, 100.0)),
            [0.0, 50.0, 90.0, 50.0]
        );
    }

    #[test]
    fn the_device_pixel_ratio_scales_the_box() {
        assert_eq!(
            page_scissor((1.0, 0.0, 0.0), 2.0, (100.0, 50.0), (400.0, 200.0)),
            [0.0, 100.0, 200.0, 100.0]
        );
    }
}
