//! Content type and extension rules for imported assets (the former TS `assetMimeType` and `assetExtension`).

/// Content type for an imported asset, derived from its extension.
///
/// SVG is deliberately not served as `image/svg+xml`: that type is a scripting context,
/// and an imported file is stored, not trusted. Anything unrecognised gets the same treatment.
#[must_use]
pub fn asset_mime_type(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

/// Lowercased extension of a path, defaulting to `png` when there is none.
///
/// A dot counts only when it sits inside the final segment and is not its first character,
/// so `user.1/page/noext` and `a/.hidden` have no extension.
#[must_use]
pub fn asset_extension(path: &str) -> String {
    let slash_end = path.rfind('/').map_or(0, |slash| slash + 1);
    match path.rfind('.') {
        Some(dot) if dot > slash_end => path[dot + 1..].to_lowercase(),
        _ => "png".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::{asset_extension, asset_mime_type};

    #[test]
    fn svg_and_unknown_types_are_octet_stream() {
        assert_eq!(asset_mime_type("svg"), "application/octet-stream");
        assert_eq!(asset_mime_type("html"), "application/octet-stream");
        assert_eq!(asset_mime_type("png"), "image/png");
        assert_eq!(asset_mime_type("jpeg"), "image/jpeg");
    }

    #[test]
    fn extension_comes_from_the_final_segment() {
        assert_eq!(asset_extension("user-1/page-1/a.PNG"), "png");
        assert_eq!(asset_extension("user.1/page-1/noext"), "png");
        assert_eq!(asset_extension("a/b/.hidden"), "png");
        assert_eq!(asset_extension("noext"), "png");
        assert_eq!(asset_extension(".hidden"), "png");
    }
}
