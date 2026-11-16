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

/// The storage paths for an uploaded paper image: the full file and its WebP thumbnail,
/// both under `user/paper/` and sharing one random `unique` id. Returns `(full, thumb)`.
#[must_use]
pub fn paper_image_upload_paths(
    user_id: &str,
    paper_id: &str,
    unique: &str,
    ext: &str,
) -> (String, String) {
    let base = format!("{user_id}/{paper_id}/{unique}");
    (format!("{base}.full.{ext}"), format!("{base}.thumb.webp"))
}

/// The thumbnail to remove alongside a full image (TS `PaperImageStore.remove`).
///
/// Mirrors `path.replace(/\.full\.[^.]+$/, ".thumb.webp")`: the path must end in
/// `.full.<ext>` with a non-empty extension and no further dot. `None` otherwise.
#[must_use]
pub fn full_image_thumbnail_path(path: &str) -> Option<String> {
    let dot = path.rfind('.')?;
    if dot + 1 == path.len() {
        return None;
    }
    let before = &path[..dot];
    let stem = before.strip_suffix(".full")?;
    Some(format!("{stem}.thumb.webp"))
}

#[cfg(test)]
mod tests {
    use super::{
        full_image_thumbnail_path, images_of, paper_image_thumbnail_path, paper_image_upload_paths,
    };
    use serde_json::{Map, Value, json};

    // it: "a thumbnail is stored beside the full image"
    #[test]
    fn upload_paths_put_the_thumbnail_beside_the_full_image() {
        let (full, thumb) = paper_image_upload_paths("u1", "p1", "abc", "png");
        assert_eq!(full, "u1/p1/abc.full.png");
        assert_eq!(thumb, "u1/p1/abc.thumb.webp");
    }

    #[test]
    fn remove_path_maps_full_to_its_thumbnail() {
        assert_eq!(
            full_image_thumbnail_path("u1/p1/abc.full.png").as_deref(),
            Some("u1/p1/abc.thumb.webp")
        );
    }

    #[test]
    fn remove_path_needs_a_full_marker_and_an_extension() {
        assert_eq!(full_image_thumbnail_path("u1/p1/abc.png"), None);
        assert_eq!(full_image_thumbnail_path("u1/p1/abc.full."), None);
        assert_eq!(full_image_thumbnail_path("u1/p1/abc.full.a.b"), None);
        assert_eq!(full_image_thumbnail_path("u1/p1/abc"), None);
    }

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
