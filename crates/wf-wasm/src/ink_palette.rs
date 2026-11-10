//! Ink palette and contact-area exports (`wf_core::ink::palette` and
//! `wf_core::ink::contact_area`).
//!
//! A palette crosses as an array of `[name, [r, g, b]]` pairs, in the order the
//! JS object lists its keys, so `paletteName` answers as the TS loop did.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::contact_area::contact_area_mm2;
use wf_core::ink::palette::{
    Rgb, palette_css, palette_hex, palette_name, parse_css_colour, same_palette,
};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// A palette from its `[name, [r, g, b]]` pairs.
fn palette_of(palette: JsValue) -> JsResult<Vec<(String, Rgb)>> {
    serde_wasm_bindgen::from_value(palette)
}

/// [`palette_css`]: one palette entry as a CSS colour, `rgba` below an alpha of 1.
#[wasm_bindgen(js_name = paletteCss)]
pub fn palette_css_js(palette: JsValue, colour: &str, alpha: f64) -> JsResult<String> {
    Ok(palette_css(&palette_of(palette)?, colour, alpha))
}

/// [`palette_hex`]: one palette entry as `#rrggbb`.
#[wasm_bindgen(js_name = paletteHex)]
pub fn palette_hex_js(palette: JsValue, colour: &str) -> JsResult<String> {
    Ok(palette_hex(&palette_of(palette)?, colour))
}

/// [`palette_name`]: the palette name a hex colour came from, or `undefined`.
#[wasm_bindgen(js_name = paletteName)]
pub fn palette_name_js(palette: JsValue, hex: &str) -> JsResult<Option<String>> {
    Ok(palette_name(&palette_of(palette)?, hex))
}

/// [`parse_css_colour`] as `[r, g, b]` in 0..1, or `undefined` for a colour it does not read.
#[wasm_bindgen(js_name = parseCssColour)]
#[must_use]
pub fn parse_css_colour_js(value: &str) -> Option<Vec<f64>> {
    parse_css_colour(value).map(|rgb| rgb.to_vec())
}

/// [`same_palette`]: whether two palettes draw the same.
#[wasm_bindgen(js_name = samePalette)]
pub fn same_palette_js(a: JsValue, b: JsValue) -> JsResult<bool> {
    Ok(same_palette(&palette_of(a)?, &palette_of(b)?))
}

/// [`contact_area_mm2`]: a touch's contact area in mm², from its CSS-pixel box.
#[wasm_bindgen(js_name = contactAreaMm2)]
#[must_use]
pub fn contact_area_mm2_js(width: f64, height: f64) -> f64 {
    contact_area_mm2(width, height)
}
