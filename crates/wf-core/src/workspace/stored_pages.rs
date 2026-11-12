//! Leftovers of `diffAgainstWorkspace` and `reanchorAssets` in
//! `apps/web/src/features/workspace/application/parts-1.ts`: the stored digest of each
//! note (what an update would overwrite) and the storage path of each owned asset folder
//! path. Reading the rows and the folder stays in TypeScript.

use indexmap::IndexMap;

use crate::sync::change_origin::digest_text;

/// A note's id, title and body as stored.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct StoredPage {
    /// The note's id.
    pub id: String,
    /// The note's title.
    pub title: String,
    /// The note's body.
    pub body: String,
}

/// The digest of a note's title and body, as one text: `title` newline `body`.
#[must_use]
pub fn stored_digest(title: &str, body: &str) -> String {
    digest_text(&format!("{title}\n{body}"))
}

/// Each note's stored digest by id, in the order given.
#[must_use]
pub fn stored_digests(pages: &[StoredPage]) -> IndexMap<String, String> {
    pages
        .iter()
        .map(|page| (page.id.clone(), stored_digest(&page.title, &page.body)))
        .collect()
}

/// The storage path of an owned asset folder path (`assets/<scope>/<path>` becomes
/// `<path>`): the path with its first two segments dropped.
#[must_use]
pub fn storage_path(folder_path: &str) -> String {
    folder_path.split('/').skip(2).collect::<Vec<_>>().join("/")
}

/// Each owned folder path mapped to its storage path, by folder path, in the order given.
#[must_use]
pub fn owned_storage(folder_paths: &[String]) -> IndexMap<String, String> {
    folder_paths
        .iter()
        .map(|folder_path| (folder_path.clone(), storage_path(folder_path)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(id: &str, title: &str, body: &str) -> StoredPage {
        StoredPage { id: id.to_owned(), title: title.to_owned(), body: body.to_owned() }
    }

    // Rust-only: a note's digest is the digest of its title, a newline, then its body.
    #[test]
    fn a_note_digest_is_the_digest_of_title_newline_body() {
        let digests = stored_digests(&[page("n1", "Title", "Body")]);
        assert_eq!(digests.get("n1"), Some(&digest_text("Title\nBody")));
    }

    // Rust-only: a changed body changes the stored digest.
    #[test]
    fn a_changed_body_changes_the_stored_digest() {
        assert_ne!(stored_digest("T", "one"), stored_digest("T", "two"));
    }

    // Rust-only: an asset folder path maps to its storage path by dropping the scope.
    #[test]
    fn an_owned_folder_path_maps_to_its_storage_path() {
        assert_eq!(storage_path("assets/papers/fig/a.webp"), "fig/a.webp");
        let map = owned_storage(&["assets/n/x.webp".to_owned()]);
        assert_eq!(map.get("assets/n/x.webp").map(String::as_str), Some("x.webp"));
    }
}
