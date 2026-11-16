//! wasm exports for `shortcut_label` (TS: `shortcut-label.ts`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::shortcut_label;

/// [`shortcut_label::key_label`]: one keycap, `⌘` reads `Ctrl` off a Mac.
#[wasm_bindgen(js_name = keyLabel)]
#[must_use]
pub fn key_label_js(key: &str, mac: bool) -> String {
    shortcut_label::key_label(key, mac)
}

/// [`shortcut_label::shortcut_label`]: a whole chord, `⌘⇧F` reads `Ctrl+Shift+F` off a Mac.
#[wasm_bindgen(js_name = shortcutLabel)]
#[must_use]
pub fn shortcut_label_js(chord: &str, mac: bool) -> String {
    shortcut_label::shortcut_label(chord, mac)
}
