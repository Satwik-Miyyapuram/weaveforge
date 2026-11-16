//! Rules both HTML relays share: which responses count as a web page.

use super::pdf_response::media_type_essence;

/// A web page, as a relay judges a response by its `Content-Type`. Missing or empty values are
/// not pages.
#[must_use]
pub fn is_html_content_type(value: Option<&str>) -> bool {
    match value {
        None => false,
        Some("") => false,
        Some(raw) => {
            let essence = media_type_essence(raw);
            essence == "text/html" || essence == "application/xhtml+xml"
        }
    }
}
