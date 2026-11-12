//! Content-type decisions for the two paste fetches (TS `apps/web/src/backend/net/fetch-for-paste.ts`).
//! Pure: the fetch and the byte limits stay in TS.

/// Image types a pasted link may become. Deliberately not sniffed from the bytes: a server that
/// echoes whatever it is sent, served back through our own origin, is a stored-XSS delivery
/// mechanism, and SVG is a script carrier even when it is honest.
const IMAGE_TYPES: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
    "image/bmp",
    "image/tiff",
];

/// The image type to keep, when the header names one of [`IMAGE_TYPES`].
///
/// Parameters after `;` are dropped, then the type is trimmed and lowercased, as the TS did.
/// Returns `None` for anything that is not an allowed image type.
#[must_use]
pub fn paste_image_type(content_type: &str) -> Option<String> {
    let essence = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    IMAGE_TYPES.contains(&essence.as_str()).then_some(essence)
}

/// True when the header says the body is HTML or XHTML, the only bodies a title can be read from.
/// A prefix match on the raw header, case-insensitive, as the TS regex was.
#[must_use]
pub fn is_html_content_type(content_type: &str) -> bool {
    let lower = content_type.to_ascii_lowercase();
    lower.starts_with("text/html") || lower.starts_with("application/xhtml")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_image_type_keeps_its_essence_only() {
        assert_eq!(
            paste_image_type("Image/PNG; charset=binary"),
            Some("image/png".to_owned())
        );
        assert_eq!(
            paste_image_type("image/jpeg"),
            Some("image/jpeg".to_owned())
        );
    }

    #[test]
    fn svg_and_other_types_are_refused_not_sniffed() {
        assert_eq!(paste_image_type("image/svg+xml"), None);
        assert_eq!(paste_image_type("text/html"), None);
        assert_eq!(paste_image_type(""), None);
    }

    #[test]
    fn html_and_xhtml_are_readable_for_a_title() {
        assert!(is_html_content_type("text/html; charset=utf-8"));
        assert!(is_html_content_type("Application/XHTML+xml"));
        assert!(!is_html_content_type("application/pdf"));
        assert!(!is_html_content_type(" text/html"));
    }
}
