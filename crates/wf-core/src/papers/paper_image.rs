//! Paper figure variant names: the thumbnail a figure is stored under beside its full image.

use serde_json::{Map, Value};

/// Deterministic private-object name of a figure's thumbnail variant.
///
/// The extension and a `.full` marker before it are replaced by `.thumb.webp`,
/// so `x.png` and `x.full.png` both give `x.thumb.webp`. A path without an
/// extension gets `.thumb.webp` appended.
#[must_use]
pub fn paper_image_thumbnail_path(path: &str) -> String {
    match base_before_extension(path) {
        Some(base) => format!("{base}.thumb.webp"),
        None => format!("{path}.thumb.webp"),
    }
}

/// The path without its last extension (and without a `.full` marker before
/// it), or `None` when there is no non-empty extension or a line break sits
/// before the dot (the regex this mirrors cannot span a line).
fn base_before_extension(path: &str) -> Option<&str> {
    let dot = path.rfind('.')?;
    if dot + 1 == path.len() {
        return None;
    }
    let base = &path[..dot];
    if base.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
        return None;
    }
    Some(base.strip_suffix(".full").unwrap_or(base))
}

/// The storage paths of a paper's attached images (TS `imagesOf`): the string entries of
/// `metadata.images`, and none when it is absent or not a list.
#[must_use]
pub fn images_of(metadata: &Map<String, Value>) -> Vec<String> {
    metadata
        .get("images")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{images_of, paper_image_thumbnail_path};
    use serde_json::{Map, Value, json};

    #[test]
    fn images_of_keeps_only_string_entries() {
        let mut metadata = Map::new();
        assert!(images_of(&metadata).is_empty());
        let _ = metadata.insert("images".into(), json!(["a.png", 3, "b.webp"]));
        assert_eq!(images_of(&metadata), vec!["a.png", "b.webp"]);
        let _ = metadata.insert("images".into(), Value::String("x".into()));
        assert!(images_of(&metadata).is_empty());
    }

    #[test]
    fn thumbnail_replaces_the_extension() {
        assert_eq!(paper_image_thumbnail_path("a/x.png"), "a/x.thumb.webp");
        assert_eq!(paper_image_thumbnail_path("a/x.jpeg"), "a/x.thumb.webp");
    }

    #[test]
    fn full_marker_is_dropped() {
        assert_eq!(paper_image_thumbnail_path("a/x.full.png"), "a/x.thumb.webp");
        assert_eq!(
            paper_image_thumbnail_path("x.full.full.png"),
            "x.full.thumb.webp"
        );
        assert_eq!(
            paper_image_thumbnail_path("a.full"),
            "a.thumb.webp",
            "the last extension is the one replaced"
        );
    }

    #[test]
    fn only_the_last_dot_counts() {
        assert_eq!(paper_image_thumbnail_path("a.b.c.d"), "a.b.c.thumb.webp");
        assert_eq!(paper_image_thumbnail_path("dir.v1/file"), "dir.thumb.webp");
    }

    #[test]
    fn no_extension_appends_the_suffix() {
        assert_eq!(paper_image_thumbnail_path("noext"), "noext.thumb.webp");
        assert_eq!(
            paper_image_thumbnail_path("a."),
            "a..thumb.webp",
            "an empty extension is none"
        );
        assert_eq!(paper_image_thumbnail_path(".png"), ".thumb.webp");
    }
}
