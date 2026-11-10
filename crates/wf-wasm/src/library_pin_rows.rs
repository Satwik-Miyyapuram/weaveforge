//! Library pin row mapping for JavaScript (wf-core `library_pin_rows`).

use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::library_pin_rows::{PinRow, to_domain};

use super::to_js;

/// [`to_domain`]: a `library_pins` row as a library pin.
///
/// # Errors
///
/// Fails if the row cannot be read as a `library_pins` row.
#[wasm_bindgen(js_name = libraryPinRowToDomain, unchecked_return_type = "B.LibraryPin")]
pub fn library_pin_row_to_domain_js(
    #[wasm_bindgen(unchecked_param_type = "B.PinRow")] row: JsValue,
) -> Result<JsValue, JsError> {
    let row: PinRow =
        serde_wasm_bindgen::from_value(row).map_err(|error| JsError::new(&error.to_string()))?;
    to_js(&to_domain(&row)).map_err(|error| JsError::new(&error.to_string()))
}
