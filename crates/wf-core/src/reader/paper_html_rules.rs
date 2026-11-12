//! Rules both HTML relays share: which responses count as a web page, and which charset the page
//! declares. The byte decoding itself stays in TS (`TextDecoder`), which takes the charset from
//! here.

use regex_lite::Regex;

use super::pdf_response::media_type_essence;

/// Bytes of the body scanned for a `<meta charset>` declaration.
const HEAD_WINDOW: usize = 4096;

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

/// The charset a page declares, lowercased: from the `Content-Type` header if it names one, else
/// from a `<meta>` in the first 4 KiB, else `utf-8`.
#[must_use]
pub fn declared_charset(content_type: Option<&str>, bytes: &[u8]) -> String {
    let header_pattern = Regex::new(r#"(?i)charset\s*=\s*"?([\w.:-]+)"#);
    let meta_pattern = Regex::new(r#"(?i)<meta[^>]+charset\s*=\s*["']?([\w.:-]+)"#);
    if let (Some(raw), Ok(pattern)) = (content_type, header_pattern)
        && let Some(found) = pattern.captures(raw).and_then(|c| c.get(1))
    {
        return found.as_str().to_lowercase();
    }
    let head: String = bytes[..bytes.len().min(HEAD_WINDOW)]
        .iter()
        .map(|&byte| char::from(byte))
        .collect();
    if let Ok(pattern) = meta_pattern
        && let Some(found) = pattern.captures(&head).and_then(|c| c.get(1))
    {
        return found.as_str().to_lowercase();
    }
    "utf-8".to_owned()
}
