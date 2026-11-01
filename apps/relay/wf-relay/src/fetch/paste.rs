//! Pure checks behind the paste fetches. Ported from apps/web/src/backend/net/fetch-for-paste.ts.

use super::is_js_space;
use super::page_title::{PAGE_TITLE_SCAN_CHARS, extract_page_title};

/// Largest page body read for a title (TS `TITLE_BYTES`).
pub const TITLE_BYTES: usize = 512 * 1024;

/// Largest image body (TS `IMAGE_BYTES`).
pub const IMAGE_BYTES: usize = 12 * 1024 * 1024;

/// Accept header for the title fetch (TS `fetchPageTitle`).
pub const TITLE_ACCEPT: &str = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";

/// Accept header for the image fetch (TS `fetchRemoteImage`).
pub const IMAGE_ACCEPT: &str = "image/*";

/// A refusal the page shows: an HTTP-like status and a sentence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PasteRefusal {
    /// HTTP-like status code.
    pub status: u16,
    /// Sentence shown to the user.
    pub message: &'static str,
}

/// The address is not HTML or XHTML.
pub const NOT_A_PAGE: PasteRefusal = PasteRefusal {
    status: 415,
    message: "That address is not a web page.",
};

/// The page has no `<title>`.
pub const NO_TITLE: PasteRefusal = PasteRefusal {
    status: 404,
    message: "That page has no title.",
};

/// The page answered with a challenge screen; its title is not the page's.
pub const BOT_WALL: PasteRefusal = PasteRefusal {
    status: 403,
    message: "That site blocked automated access.",
};

/// The address is not a supported image type.
pub const NOT_AN_IMAGE: PasteRefusal = PasteRefusal {
    status: 415,
    message: "That address is not an image.",
};

/// Image types accepted by TS `IMAGE_TYPES`, lowercase.
const IMAGE_TYPES: [&str; 7] = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
    "image/bmp",
    "image/tiff",
];

/// True when the content type starts with `text/html` or `application/xhtml`, ASCII case-insensitively.
#[must_use]
pub fn is_page_content_type(content_type: &str) -> bool {
    ["text/html", "application/xhtml"].iter().any(|prefix| {
        content_type
            .as_bytes()
            .get(..prefix.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(prefix.as_bytes()))
    })
}

/// Decodes the part of a page body a title can be in. Drops one leading UTF-8 BOM, as TextDecoder does.
#[must_use]
pub fn decode_title_head(body: &[u8]) -> String {
    let limit = body.len().min(PAGE_TITLE_SCAN_CHARS);
    let head = body.get(..limit).unwrap_or(body);
    let without_bom = head.strip_prefix(&[0xEF_u8, 0xBB, 0xBF]).unwrap_or(head);
    String::from_utf8_lossy(without_bom).into_owned()
}

/// Returns the page title, or the refusal the page should show instead.
#[must_use = "the refusal must be shown or handled"]
pub fn title_from_page(content_type: &str, body: &[u8]) -> Result<String, PasteRefusal> {
    if !is_page_content_type(content_type) {
        return Err(NOT_A_PAGE);
    }
    let found = extract_page_title(&decode_title_head(body)).ok_or(NO_TITLE)?;
    if found.suspect {
        return Err(BOT_WALL);
    }
    Ok(found.title)
}

/// Returns the lowercase media type of an image response, or the refusal for anything else.
#[must_use = "the refusal must be shown or handled"]
pub fn image_content_type(content_type: &str) -> Result<String, PasteRefusal> {
    let media = content_type.split(';').next().unwrap_or("");
    let base = media.trim_matches(is_js_space).to_lowercase();
    if IMAGE_TYPES.contains(&base.as_str()) {
        Ok(base)
    } else {
        Err(NOT_AN_IMAGE)
    }
}
