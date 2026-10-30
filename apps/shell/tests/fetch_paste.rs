//! Tests for the pure checks behind the paste fetches (ported from apps/web/src/backend/net/fetch-for-paste.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]

use weaveforge_shell::fetch::paste::{
    BOT_WALL, IMAGE_ACCEPT, IMAGE_BYTES, NO_TITLE, NOT_A_PAGE, NOT_AN_IMAGE, TITLE_ACCEPT,
    TITLE_BYTES, decode_title_head, image_content_type, is_page_content_type, title_from_page,
};

#[test]
fn constants() {
    assert_eq!(TITLE_BYTES, 524_288);
    assert_eq!(IMAGE_BYTES, 12_582_912);
    assert_eq!(NOT_A_PAGE.status, 415);
    assert_eq!(NOT_A_PAGE.message, "That address is not a web page.");
    assert_eq!(NO_TITLE.status, 404);
    assert_eq!(NO_TITLE.message, "That page has no title.");
    assert_eq!(BOT_WALL.status, 403);
    assert_eq!(BOT_WALL.message, "That site blocked automated access.");
    assert_eq!(NOT_AN_IMAGE.status, 415);
    assert_eq!(NOT_AN_IMAGE.message, "That address is not an image.");
    assert_eq!(
        TITLE_ACCEPT,
        "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
    );
    assert_eq!(IMAGE_ACCEPT, "image/*");
}

#[test]
fn page_content_types() {
    assert!(is_page_content_type("text/html"));
    assert!(is_page_content_type("TEXT/HTML; charset=utf-8"));
    assert!(is_page_content_type("application/xhtml+xml"));
    assert!(is_page_content_type("text/htmlx"));
    assert!(!is_page_content_type(""));
    assert!(!is_page_content_type("text/plain"));
    assert!(!is_page_content_type(" text/html"));
    assert!(!is_page_content_type("application/json"));
    assert!(!is_page_content_type("text/htm"));
}

#[test]
fn decode_head() {
    assert_eq!(decode_title_head(b"\xEF\xBB\xBFab"), "ab");
    assert_eq!(decode_title_head(b"\xEF\xBB\xBF\xEF\xBB\xBFa"), "\u{FEFF}a");
    assert_eq!(decode_title_head(b"a\xFFb"), "a\u{FFFD}b");
    assert_eq!(decode_title_head(b"\xE2\x82"), "\u{FFFD}");

    let mut body = vec![b'a'; 200_000];
    body.extend_from_slice(b"<title>X</title>");
    let decoded = decode_title_head(&body);
    assert_eq!(decoded.len(), 200_000);
    assert!(!decoded.contains("<title>"));
}

#[test]
fn title_cases() {
    assert_eq!(
        title_from_page("text/html", b"<title>Hi</title>"),
        Ok("Hi".to_string())
    );
    assert_eq!(
        title_from_page("application/json", b"<title>Hi</title>"),
        Err(NOT_A_PAGE)
    );
    assert_eq!(title_from_page("text/html", b"<p>none</p>"), Err(NO_TITLE));
    assert_eq!(
        title_from_page("text/html", b"<title>Just a moment...</title>"),
        Err(BOT_WALL)
    );
    assert_eq!(
        title_from_page("text/html", b"<title>&amp; Co</title>"),
        Ok("& Co".to_string())
    );

    let mut body = vec![b' '; 200_000];
    body.extend_from_slice(b"<title>Late</title>");
    assert_eq!(title_from_page("text/html", &body), Err(NO_TITLE));
}

#[test]
fn image_types() {
    assert_eq!(image_content_type("image/png"), Ok("image/png".to_string()));
    assert_eq!(
        image_content_type("IMAGE/JPEG; q=1"),
        Ok("image/jpeg".to_string())
    );
    assert_eq!(
        image_content_type(" image/webp ;x"),
        Ok("image/webp".to_string())
    );
    assert_eq!(
        image_content_type("\u{FEFF}image/gif"),
        Ok("image/gif".to_string())
    );
    assert_eq!(image_content_type("image/jpg"), Err(NOT_AN_IMAGE));
    assert_eq!(image_content_type("image/svg+xml"), Err(NOT_AN_IMAGE));
    assert_eq!(image_content_type("image/png2"), Err(NOT_AN_IMAGE));
    assert_eq!(image_content_type(""), Err(NOT_AN_IMAGE));
    assert_eq!(image_content_type("text/html"), Err(NOT_AN_IMAGE));
}
