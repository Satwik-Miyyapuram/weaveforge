//! Paste cleanup: the rules `packages/core/src/paste` applied to clipboard text.
//!
//! Every offset and range in this module is a byte offset into a `&str`. The
//! WASM layer converts the one offset the web passes in (UTF-16 units). Lengths
//! the TypeScript compared against a limit (line widths, caps) are counted in
//! UTF-16 units with [`crate::search::js_text::utf16_len`], as `.length` did.

pub mod clean_pasted_text;
pub mod control_characters;
pub mod markdown_link;
pub mod markdown_ranges;
pub mod paste_settings;
pub mod pdf_text;
pub mod quote_commas;
pub mod scholarly_links;
pub mod tabular_text;
pub mod text_range;
pub mod tracking_parameters;
pub mod typography;
pub mod url_cleanup;
pub mod wrapped_text;

use serde::Serialize;

/// A rule's output: the new text and whether it differs from the input.
/// The TypeScript had one interface per rule with these two fields.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TextResult {
    /// The text after the rule ran.
    pub text: String,
    /// True when `text` differs from the input.
    pub changed: bool,
}

impl TextResult {
    /// Wraps `text`, comparing it with `input`.
    #[must_use]
    pub fn new(input: &str, text: String) -> Self {
        let changed = text != input;
        Self { text, changed }
    }
}
