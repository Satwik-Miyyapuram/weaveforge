//! Port of `looksLikeImageUrl` in packages/core/src/net/page-title.ts. Pure.
//!
//! A pasted link is downloaded as a picture only when its own path ends in a
//! picture extension. No extension means no request: a note is not a reason to
//! fetch every link somebody pastes.

/// Extensions that name a picture, without the dot. Matched case-insensitively.
const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "tif", "tiff",
];

/// True when the URL's path ends in a picture extension.
///
/// Mirrors `new URL(url).pathname` matched against `/\.(?:png|jpe?g|gif|webp|avif|bmp|tiff?)$/i`.
/// The last dot in the path is the only one that can start the extension, since
/// the extension itself holds no dot or slash. Anything that is not a URL is false.
#[must_use]
pub fn looks_like_image_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    let Some((_, extension)) = parsed.path().rsplit_once('.') else {
        return false;
    };
    IMAGE_EXTENSIONS
        .iter()
        .any(|known| extension.eq_ignore_ascii_case(known))
}

#[cfg(test)]
mod tests {
    use super::looks_like_image_url;

    #[test]
    fn picture_extensions_match_in_any_case_and_ignore_the_query() {
        assert!(looks_like_image_url("https://a.example/figure.png"));
        assert!(looks_like_image_url("https://a.example/figure.JPEG?width=200"));
        assert!(looks_like_image_url("https://a.example/x.jpg"));
        assert!(looks_like_image_url("https://a.example/x.tiff#frag"));
    }

    #[test]
    fn a_picture_extension_that_is_not_last_does_not_count() {
        assert!(!looks_like_image_url("https://a.example/a.png.html"));
        assert!(!looks_like_image_url("https://a.example/a.png/b"));
        assert!(!looks_like_image_url("https://a.example/article"));
    }

    #[test]
    fn anything_that_is_not_a_url_is_not_an_image() {
        assert!(!looks_like_image_url("not a url"));
        assert!(!looks_like_image_url(""));
    }
}
