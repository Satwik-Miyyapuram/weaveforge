//! Ink note stroke paths and chunk ids. Port of the path and id half of
//! `packages/core/src/ink/parts-2.ts` (`isInkNoteId` to `newInkChunkId`).
//!
//! A note's strokes live in a folder named after the note's file:
//! `notes/foo.ink.md` keeps its pages in `notes/foo.ink/<ulid>.inkb`. The pair is
//! made by file name alone, so a note whose id changes still finds its strokes.

use serde::Serialize;

use crate::sync::ink_note::is_ink_chunk_id;
use crate::workspace::safe_workspace_path;

/// The old top-level `.ink/<weaveforge-id>/` folder. Read only by the one-time
/// migration into the per-note folder; nothing finds strokes here any more.
pub const LEGACY_INK_DIR: &str = ".ink";

/// The extension of an ink note's text file.
pub const INK_NOTE_EXT: &str = ".ink.md";

/// The extension of an ink note's strokes folder.
pub const INK_STROKES_DIR_EXT: &str = ".ink";

/// Chunk file extension: one page, columnar binary, compressed.
pub const INK_CHUNK_EXT: &str = ".inkb";

/// Crockford base32 alphabet: one character per five bits.
const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// The note and chunk a strokes path names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InkChunkPath {
    /// The note's `.ink.md` path, the strokes folder plus `.md`.
    pub note_path: String,
    /// The chunk id, the filename without its extension.
    pub chunk_id: String,
}

/// Whether `id` is safe to weave into a path: 1 to 64 ASCII letters, digits, `_` or `-`.
#[must_use]
pub fn is_ink_note_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Whether a folder name holds ink strokes: `foo.ink`, or the legacy `.ink`.
#[must_use]
pub fn is_ink_strokes_segment(segment: &str) -> bool {
    segment.ends_with(INK_STROKES_DIR_EXT)
}

/// `x/foo.ink.md` -> `x/foo.ink`: the folder beside the note that holds its pages.
///
/// # Errors
///
/// Fails when `note_path` is not a normalized, workspace-relative `<name>.ink.md` path.
pub fn ink_strokes_dir(note_path: &str) -> Result<String, String> {
    let usable = note_path.ends_with(INK_NOTE_EXT)
        && note_path.rsplit('/').next() != Some(INK_NOTE_EXT)
        && safe_workspace_path(note_path).as_deref() == Ok(note_path);
    if !usable {
        return Err(unusable("note path", note_path));
    }
    Ok(note_path[..note_path.len() - ".md".len()].to_owned())
}

/// `x/foo.ink/<ulid>.inkb`, one page of one note.
///
/// # Errors
///
/// Fails when `chunk_id` is not a chunk id, or `note_path` is not an ink note path.
pub fn ink_chunk_path(note_path: &str, chunk_id: &str) -> Result<String, String> {
    if !is_ink_chunk_id(chunk_id) {
        return Err(unusable("chunk id", chunk_id));
    }
    Ok(format!(
        "{}/{chunk_id}{INK_CHUNK_EXT}",
        ink_strokes_dir(note_path)?
    ))
}

/// `.ink/<weaveforge-id>`: where strokes lived before they moved beside their note.
/// Only the one-time migration reads it.
///
/// # Errors
///
/// Fails when `note_id` is not a safe id.
pub fn legacy_ink_dir(note_id: &str) -> Result<String, String> {
    if !is_ink_note_id(note_id) {
        return Err(unusable("note id", note_id));
    }
    Ok(format!("{LEGACY_INK_DIR}/{note_id}"))
}

fn unusable(what: &str, id: &str) -> String {
    // JSON string quoting matches the JS `JSON.stringify` in the error text.
    let quoted = serde_json::to_string(id).unwrap_or_default();
    format!("ink: unusable {what} {quoted}")
}

/// The note and chunk a strokes path names, or `None` for anything else,
/// including a page in the legacy `.ink/<id>/` folder.
///
/// Leading slashes are ignored, as the TypeScript does.
#[must_use]
pub fn parse_ink_chunk_path(path: &str) -> Option<InkChunkPath> {
    let (dir, file) = path.trim_start_matches('/').rsplit_once('/')?;
    let chunk_id = file.strip_suffix(INK_CHUNK_EXT)?;
    if !is_ink_chunk_id(chunk_id) {
        return None;
    }
    let note_path = format!("{dir}.md");
    ink_strokes_dir(&note_path).ok()?;
    Some(InkChunkPath {
        note_path,
        chunk_id: chunk_id.to_owned(),
    })
}

/// The chunk id a filename names, or `None` when it is not `<chunk id>.inkb`.
#[must_use]
pub fn chunk_id_of_file_name(name: &str) -> Option<&str> {
    let id = name.strip_suffix(INK_CHUNK_EXT)?;
    is_ink_chunk_id(id).then_some(id)
}

/// Blob bucket that holds ink chunks: the bucket the vault's assets already use, so the
/// bucket's policy, keyed on the user's prefix, covers them too.
pub const INK_CHUNK_BUCKET: &str = "vault-assets";

/// Content type of a chunk blob.
pub const INK_CHUNK_CONTENT_TYPE: &str = "application/octet-stream";

/// Where and how a chunk blob is stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InkChunkBlobSpec {
    /// The bucket the chunk lives in.
    pub bucket: &'static str,
    /// The content type the chunk is uploaded with.
    pub content_type: &'static str,
}

/// The bucket and content type every chunk blob is stored with.
#[must_use]
pub fn ink_chunk_blob_spec() -> InkChunkBlobSpec {
    InkChunkBlobSpec {
        bucket: INK_CHUNK_BUCKET,
        content_type: INK_CHUNK_CONTENT_TYPE,
    }
}

/// `<user>/<weaveforge-id>/ink/<ulid>.inkb`: where one chunk sits in the blob bucket, under the
/// user's prefix, beside the vault's other assets.
///
/// # Errors
///
/// Fails when `note_id` is not a safe id, or `chunk_id` is not a chunk id.
pub fn ink_chunk_blob_key(user_id: &str, note_id: &str, chunk_id: &str) -> Result<String, String> {
    if !is_ink_note_id(note_id) {
        return Err(unusable("note id", note_id));
    }
    if !is_ink_chunk_id(chunk_id) {
        return Err(unusable("chunk id", chunk_id));
    }
    Ok(format!("{user_id}/{note_id}/ink/{chunk_id}{INK_CHUNK_EXT}"))
}

/// The chunk ids named by a folder listing: the `<ulid>.inkb` files among `paths`, sorted.
/// Anything else in the folder, such as a thumbnail, is skipped.
#[must_use]
pub fn ink_chunk_ids_in_listing(paths: &[String]) -> Vec<String> {
    let mut ids: Vec<String> = paths
        .iter()
        .filter_map(|path| {
            let name = path.rsplit('/').next().unwrap_or_default();
            chunk_id_of_file_name(name).map(str::to_owned)
        })
        .collect();
    ids.sort();
    ids
}

/// The character for a 0..32 digit value; `0` for anything out of range.
fn digit(value: usize) -> u8 {
    CROCKFORD.get(value).copied().unwrap_or(b'0')
}

/// A fresh chunk id: a ULID, sortable by creation and collision-free in practice.
///
/// `now_ms` is the epoch time in milliseconds (`Date.now()` in JS). `random_bytes` are the
/// random bytes JS fills from `crypto.getRandomValues`: pass a 10-byte buffer. A missing byte
/// counts as `0`, as in the TypeScript.
///
/// # Errors
///
/// Fails when `now_ms` is not finite.
pub fn new_ink_chunk_id(now_ms: f64, random_bytes: &[u8]) -> Result<String, String> {
    if !now_ms.is_finite() {
        return Err(format!("ink: unusable time {now_ms}"));
    }

    let mut time = [b'0'; 10];
    let mut remaining = now_ms.floor().max(0.0);
    for slot in time.iter_mut().rev() {
        *slot = digit((remaining % 32.0) as usize);
        remaining = (remaining / 32.0).floor();
    }

    // Eighty random bits, five per character, most significant bit first.
    let byte = |index: usize| u16::from(random_bytes.get(index).copied().unwrap_or(0));
    let mut random = [b'0'; 16];
    for (i, slot) in random.iter_mut().enumerate() {
        let start = i * 5;
        let window = (byte(start >> 3) << 8) | byte((start >> 3) + 1);
        *slot = digit(usize::from((window >> (11 - (start & 7))) & 31));
    }

    Ok(time
        .iter()
        .chain(random.iter())
        .map(|b| char::from(*b))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{
        InkChunkBlobSpec, InkChunkPath, ink_chunk_blob_key, ink_chunk_blob_spec,
        ink_chunk_ids_in_listing, ink_chunk_path, ink_strokes_dir, is_ink_note_id,
        is_ink_strokes_segment, legacy_ink_dir, new_ink_chunk_id, parse_ink_chunk_path,
    };
    use crate::sync::ink_note::is_ink_chunk_id;

    const CHUNK_A: &str = "01JABC0DEF0GH0JK0MN0PQ0RST";

    #[test]
    fn strokes_sit_in_a_folder_named_after_the_note_file() {
        assert_eq!(
            ink_strokes_dir("p/notes/foo.ink.md"),
            Ok("p/notes/foo.ink".to_owned())
        );
        let path = ink_chunk_path("p/notes/foo.ink.md", CHUNK_A).unwrap_or_default();
        assert_eq!(path, format!("p/notes/foo.ink/{CHUNK_A}.inkb"));
        assert_eq!(
            parse_ink_chunk_path(&path),
            Some(InkChunkPath {
                note_path: "p/notes/foo.ink.md".to_owned(),
                chunk_id: CHUNK_A.to_owned(),
            })
        );
        assert_eq!(parse_ink_chunk_path("notes/foo.ink/not-a-chunk.inkb"), None);
        assert_eq!(
            parse_ink_chunk_path(&format!("notes/foo/{CHUNK_A}.inkb")),
            None
        );
        assert_eq!(
            parse_ink_chunk_path(&format!("notes/foo.ink/x/{CHUNK_A}.inkb")),
            None
        );
        assert_eq!(parse_ink_chunk_path(""), None);
    }

    #[test]
    fn the_old_id_keyed_folder_is_not_a_strokes_folder() {
        // `.ink/<id>/` is read only by the one-time migration, never as a note's strokes.
        assert_eq!(
            parse_ink_chunk_path(&format!(".ink/01JNOTE/{CHUNK_A}.inkb")),
            None
        );
        assert_eq!(parse_ink_chunk_path(&format!(".ink/{CHUNK_A}.inkb")), None);
        assert_eq!(legacy_ink_dir("01JNOTE"), Ok(".ink/01JNOTE".to_owned()));
    }

    #[test]
    fn only_a_safe_ink_note_path_names_a_strokes_folder() {
        for bad in [
            "p/foo.md",
            "p/foo.ink",
            "../foo.ink.md",
            "/p/foo.ink.md",
            "p/.ink.md",
            "",
            "C:/foo.ink.md",
            "p//foo.ink.md",
        ] {
            assert!(
                matches!(ink_strokes_dir(bad), Err(e) if e.contains("unusable note path")),
                "{bad}"
            );
        }
        assert_eq!(
            parse_ink_chunk_path(&format!("../x.ink/{CHUNK_A}.inkb")),
            None
        );
        assert_eq!(
            parse_ink_chunk_path(&format!("p/.ink/{CHUNK_A}.inkb")),
            None
        );
    }

    #[test]
    fn path_shaped_ids_are_refused() {
        assert!(is_ink_note_id("01JNOTE"));
        assert!(!is_ink_note_id("../escape"));
        assert!(!is_ink_note_id("a/b"));
        assert!(!is_ink_note_id(""));
        assert!(is_ink_note_id(&"a".repeat(64)));
        assert!(!is_ink_note_id(&"a".repeat(65)));
        assert!(matches!(
            legacy_ink_dir("../escape"),
            Err(e) if e.contains("unusable note id")
        ));
        assert!(matches!(
            ink_chunk_path("p/foo.ink.md", "../../etc/passwd"),
            Err(e) if e.contains("unusable chunk id")
        ));
    }

    #[test]
    fn a_folder_segment_ending_in_dot_ink_holds_strokes() {
        assert!(is_ink_strokes_segment("foo.ink"));
        assert!(is_ink_strokes_segment(".ink"));
        assert!(!is_ink_strokes_segment("foo.ink.md"));
        assert!(!is_ink_strokes_segment("ink"));
        assert!(!is_ink_strokes_segment("foo.inkb"));
    }

    #[test]
    fn chunk_id_is_a_ulid_sortable_by_creation() {
        let fixed = new_ink_chunk_id(1_700_000_000_000.0, &[7; 10]).unwrap_or_default();
        assert_eq!(fixed.len(), 26);
        assert!(is_ink_chunk_id(&fixed));
        assert_eq!(
            new_ink_chunk_id(1_700_000_000_000.0, &[7; 10]),
            Ok(fixed.clone())
        );

        let later = new_ink_chunk_id(1_700_000_001_000.0, &[7; 10]).unwrap_or_default();
        assert!(later > fixed, "ids sort by the time they were made");
        assert_ne!(
            new_ink_chunk_id(1_700_000_000_000.0, &[9; 10]),
            Ok(fixed),
            "and differ when the randomness does"
        );
    }

    #[test]
    fn zero_time_and_zero_bytes_encode_as_all_zeros() {
        assert_eq!(
            new_ink_chunk_id(0.0, &[0; 10]),
            Ok("00000000000000000000000000".to_owned())
        );
    }

    #[test]
    fn a_file_name_names_a_chunk_only_when_its_id_is_valid() {
        assert_eq!(
            super::chunk_id_of_file_name(&format!("{CHUNK_A}.inkb")),
            Some(CHUNK_A)
        );
        assert_eq!(
            super::chunk_id_of_file_name(&format!("{CHUNK_A}.txt")),
            None
        );
        assert_eq!(super::chunk_id_of_file_name(".inkb"), None);
        assert_eq!(super::chunk_id_of_file_name("not-a-chunk.inkb"), None);
    }

    #[test]
    fn non_finite_time_is_refused() {
        assert!(new_ink_chunk_id(f64::NAN, &[0; 10]).is_err());
        assert!(new_ink_chunk_id(f64::INFINITY, &[0; 10]).is_err());
    }

    #[test]
    fn a_chunk_blob_key_sits_under_the_user_prefix_beside_the_vault_assets() {
        assert_eq!(
            ink_chunk_blob_key("user-1", "01JNOTE", CHUNK_A),
            Ok(format!("user-1/01JNOTE/ink/{CHUNK_A}.inkb"))
        );
        assert!(matches!(
            ink_chunk_blob_key("user-1", "../escape", CHUNK_A),
            Err(e) if e.contains("unusable note id")
        ));
        assert!(matches!(
            ink_chunk_blob_key("user-1", "01JNOTE", "../../etc/passwd"),
            Err(e) if e.contains("unusable chunk id")
        ));
    }

    #[test]
    fn chunks_are_stored_in_the_vault_bucket_as_octet_streams() {
        assert_eq!(
            ink_chunk_blob_spec(),
            InkChunkBlobSpec {
                bucket: "vault-assets",
                content_type: "application/octet-stream",
            }
        );
    }

    // it: "the folder store writes under <note>.ink/ and lists only chunks"
    #[test]
    fn a_listing_keeps_only_chunk_files_and_sorts_them() {
        let later = "01JABC0DEF0GH0JK0MN0PQ0RSZ";
        let paths = vec![
            format!("notes/a.ink/{later}.inkb"),
            "notes/a.ink/thumb.png".to_owned(),
            format!("notes/a.ink/{CHUNK_A}.inkb"),
            "notes/a.ink/notes.inkb".to_owned(),
        ];
        assert_eq!(
            ink_chunk_ids_in_listing(&paths),
            vec![CHUNK_A.to_owned(), later.to_owned()]
        );
        assert!(ink_chunk_ids_in_listing(&[]).is_empty());
    }
}
