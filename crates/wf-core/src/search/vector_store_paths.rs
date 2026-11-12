//! Where a corpus's stored vectors are keyed and filed, and how a local-database row
//! frames them. Port of the key, path, cache-file and row rules in
//! `apps/web/src/features/search/infrastructure/vector-store.ts`. The IndexedDB,
//! local-database and file-system calls stay in the TypeScript shell.

use crate::bytea::{decode_base64, encode_base64};
use crate::workspace::WORKSPACE_META_DIR;

/// The key a corpus's vectors are stored under: `-` for a workspace with no project.
#[must_use]
pub fn store_key(project_id: Option<&str>) -> String {
    project_id.unwrap_or("-").to_owned()
}

/// Where the workspace folder keeps its vector caches.
#[must_use]
pub fn folder_cache_dir() -> String {
    format!("{WORKSPACE_META_DIR}/cache")
}

/// The workspace-folder file holding one corpus's vectors.
#[must_use]
pub fn folder_path(project_id: Option<&str>) -> String {
    format!("{}/vectors-{}.bin", folder_cache_dir(), store_key(project_id))
}

/// Whether a folder-cache entry is a vector cache file, the one `clear` removes.
///
/// Matches the TypeScript `/vectors-[^/]*\.bin$` on `/` + path: the last segment must
/// start with `vectors-` and end with `.bin`. The two affixes cannot overlap, so a
/// name matching both is long enough for each.
#[must_use]
pub fn is_vector_cache_file(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.starts_with("vectors-") && name.ends_with(".bin")
}

/// A local-database row: the head JSON as base64, a dot, then the blob as base64.
#[must_use]
pub fn pack_local_row(head_json: &str, bytes: &[u8]) -> String {
    format!(
        "{}.{}",
        encode_base64(head_json.as_bytes()),
        encode_base64(bytes)
    )
}

/// The head JSON text and blob of a local row, or `None` if it is not framed that way or
/// either part does not decode. The head is decoded lossily, as `TextDecoder` does.
#[must_use]
pub fn unpack_local_row(packed: &str) -> Option<(String, Vec<u8>)> {
    let (head, blob) = packed.split_once('.')?;
    let head = String::from_utf8_lossy(&decode_base64(head).ok()?).into_owned();
    let bytes = decode_base64(blob).ok()?;
    Some((head, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_key_is_dash_without_a_project() {
        assert_eq!(store_key(None), "-");
        assert_eq!(store_key(Some("p1")), "p1");
    }

    #[test]
    fn folder_path_sits_in_the_cache_dir() {
        assert_eq!(
            folder_cache_dir(),
            format!("{WORKSPACE_META_DIR}/cache")
        );
        assert_eq!(
            folder_path(Some("p1")),
            format!("{WORKSPACE_META_DIR}/cache/vectors-p1.bin")
        );
        assert_eq!(
            folder_path(None),
            format!("{WORKSPACE_META_DIR}/cache/vectors--.bin")
        );
    }

    #[test]
    fn cache_files_are_matched_by_their_last_segment() {
        assert!(is_vector_cache_file("vectors-p1.bin"));
        assert!(is_vector_cache_file(".weaveforge/cache/vectors-p1.bin"));
        assert!(is_vector_cache_file("pdf-text/vectors-a.bin"));
        assert!(!is_vector_cache_file("vectors-p1.json"));
        assert!(!is_vector_cache_file("notes.bin"));
        assert!(!is_vector_cache_file("vectors-p1.bin/x"));
    }

    #[test]
    fn a_local_row_round_trips_head_and_blob() {
        let packed = pack_local_row("{\"model\":\"m\"}", &[1, 2, 3]);
        assert_eq!(
            unpack_local_row(&packed),
            Some(("{\"model\":\"m\"}".to_owned(), vec![1, 2, 3]))
        );
    }

    #[test]
    fn a_malformed_local_row_reads_as_a_miss() {
        assert_eq!(unpack_local_row("no-dot-here"), None);
        assert_eq!(unpack_local_row("!!.AA=="), None);
        assert_eq!(unpack_local_row("e30=.!!"), None);
    }
}
