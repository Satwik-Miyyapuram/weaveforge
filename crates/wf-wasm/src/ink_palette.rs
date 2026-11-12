//! Ink palette and contact-area exports (`wf_core::ink::palette` and
//! `wf_core::ink::contact_area`).
//!
//! A palette is the renderers' object (name to `[r, g, b]`); it is read as its
//! `[name, [r, g, b]]` pairs in `Object.keys` order, so `paletteName` answers as the TS loop did.

use js_sys::{Array, Object, Reflect};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::ink::contact_area::contact_area_mm2;
use wf_core::ink::palette::{
    Rgb, palette_css, palette_hex, palette_name, parse_css_colour, same_palette,
};

type JsResult<T> = Result<T, JsValue>;

/// A palette object as its `[name, [r, g, b]]` pairs, in `Object.keys` order.
fn palette_of(palette: &JsValue) -> JsResult<Vec<(String, Rgb)>> {
    let pairs = Array::new();
    for name in Object::keys(palette.unchecked_ref::<Object>()).iter() {
        let rgb = Array::from(&Reflect::get(palette, &name)?);
        let _ = pairs.push(&Array::of2(&name, &rgb));
    }
    Ok(serde_wasm_bindgen::from_value(pairs.into())?)
}

/// [`palette_css`]: one palette entry as a CSS colour, `rgba` below an alpha of 1.
///
/// # Errors
///
/// Throws if `palette` is not a palette object.
#[wasm_bindgen(js_name = paletteCss)]
pub fn palette_css_js(
    #[wasm_bindgen(
        unchecked_param_type = "Readonly<Record<string, readonly [number, number, number]>>"
    )]
    palette: &JsValue,
    colour: &str,
    alpha: f64,
) -> JsResult<String> {
    Ok(palette_css(&palette_of(palette)?, colour, alpha))
}

/// [`palette_hex`]: one palette entry as `#rrggbb`.
///
/// # Errors
///
/// Throws if `palette` is not a palette object.
#[wasm_bindgen(js_name = paletteHex)]
pub fn palette_hex_js(
    #[wasm_bindgen(
        unchecked_param_type = "Readonly<Record<string, readonly [number, number, number]>>"
    )]
    palette: &JsValue,
    colour: &str,
) -> JsResult<String> {
    Ok(palette_hex(&palette_of(palette)?, colour))
}

#[wasm_bindgen(typescript_custom_section)]
const PALETTE_NAME_TS: &str = r"
/** The palette name a hex colour came from, or `null`. */
export function paletteName<K extends string>(palette: Readonly<Record<K, readonly [number, number, number]>>, hex: string): K | null;
";

/// [`palette_name`]: the palette name a hex colour came from, or `null`.
///
/// # Errors
///
/// Throws if `palette` is not a palette object.
#[wasm_bindgen(js_name = paletteName, skip_typescript)]
pub fn palette_name_js(palette: &JsValue, hex: &str) -> JsResult<JsValue> {
    Ok(palette_name(&palette_of(palette)?, hex)
        .map_or(JsValue::NULL, |name| JsValue::from_str(&name)))
}

/// [`parse_css_colour`] as `[r, g, b]` in 0..1, or `null` for a colour it does not read.
#[wasm_bindgen(js_name = parseCssColour, unchecked_return_type = "[number, number, number] | null")]
#[must_use]
pub fn parse_css_colour_js(value: &str) -> JsValue {
    parse_css_colour(value).map_or(JsValue::NULL, |rgb| {
        rgb.iter()
            .map(|&c| JsValue::from_f64(c))
            .collect::<Array>()
            .into()
    })
}

/// [`same_palette`]: whether two palettes draw the same.
///
/// # Errors
///
/// Throws if `a` or `b` is not a palette object.
#[wasm_bindgen(js_name = samePalette)]
pub fn same_palette_js(
    #[wasm_bindgen(
        unchecked_param_type = "Readonly<Record<string, readonly [number, number, number]>>"
    )]
    a: &JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "Readonly<Record<string, readonly [number, number, number]>>"
    )]
    b: &JsValue,
) -> JsResult<bool> {
    Ok(same_palette(&palette_of(a)?, &palette_of(b)?))
}

/// `+event[key]`, or 0 when the side is missing (`null` or `undefined`).
fn side(event: &JsValue, key: &str) -> JsResult<f64> {
    let value = Reflect::get(event, &JsValue::from_str(key))?;
    Ok(if value.is_undefined() || value.is_null() {
        0.0
    } else {
        value.unchecked_into_f64()
    })
}

/// [`contact_area_mm2`]: a touch's contact area in mm², from its CSS-pixel box.
/// A missing side counts as 0.
///
/// # Errors
///
/// Throws if `event` cannot be read.
#[wasm_bindgen(js_name = contactAreaMm2)]
pub fn contact_area_mm2_js(
    #[wasm_bindgen(unchecked_param_type = "{ width?: number; height?: number }")] event: &JsValue,
) -> JsResult<f64> {
    Ok(contact_area_mm2(
        side(event, "width")?,
        side(event, "height")?,
    ))
}
