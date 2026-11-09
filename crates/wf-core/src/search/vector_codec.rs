//! Binary framing of a stored vector file: a little-endian `u32` length, the head
//! as UTF-8 JSON (`model`, `dimensions`, `revision`, and `hashes` when stored), then
//! the raw vector blob. Port of `packBinary` / `unpackBinary` in
//! `apps/web/src/features/search/infrastructure/vector-store.ts`. A file written by
//! either side reads back on the other.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Bytes of the little-endian head-length prefix.
const LENGTH_BYTES: usize = 4;

/// The JSON head of a stored vector file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct VectorFileHead {
    /// Encoder id the vectors came from.
    pub model: String,
    /// Width of each vector.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub dimensions: u64,
    /// Corpus fingerprint the vectors were built for.
    pub revision: String,
    /// Per-document text hashes, so a reload re-embeds only what changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional, type = BTreeMap<String, String>))]
    pub hashes: Option<BTreeMap<String, String>>,
}

/// Frame a head and its blob as one stored vector file.
#[must_use]
pub fn pack_vectors(head: &VectorFileHead, bytes: &[u8]) -> Vec<u8> {
    // A head of strings, integers and a string map always serializes.
    let json = serde_json::to_vec(head).unwrap_or_default();
    let length = u32::try_from(json.len()).unwrap_or(u32::MAX);
    let mut out = Vec::with_capacity(LENGTH_BYTES + json.len() + bytes.len());
    out.extend_from_slice(&length.to_le_bytes());
    out.extend_from_slice(&json);
    out.extend_from_slice(bytes);
    out
}

/// Read a file's head, and the offset where its blob starts.
///
/// `None` for a file cut short or whose head is not the expected JSON, so a torn
/// cache file reads as a miss rather than as wrong vectors.
#[must_use]
pub fn unpack_head(file: &[u8]) -> Option<(VectorFileHead, usize)> {
    let length_bytes: [u8; LENGTH_BYTES] = file.get(..LENGTH_BYTES)?.try_into().ok()?;
    let head_end =
        LENGTH_BYTES.checked_add(usize::try_from(u32::from_le_bytes(length_bytes)).ok()?)?;
    let head: VectorFileHead = serde_json::from_slice(file.get(LENGTH_BYTES..head_end)?).ok()?;
    Some((head, head_end))
}

/// Read a whole file back into its head and blob, or `None` if it is torn.
#[must_use]
pub fn unpack_vectors(file: &[u8]) -> Option<(VectorFileHead, Vec<u8>)> {
    let (head, blob_at) = unpack_head(file)?;
    Some((head, file[blob_at..].to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn head() -> VectorFileHead {
        VectorFileHead {
            model: "m".to_owned(),
            dimensions: 3,
            revision: "r".to_owned(),
            hashes: Some(BTreeMap::from([
                ("a".to_owned(), "x".to_owned()),
                ("b".to_owned(), "y".to_owned()),
            ])),
        }
    }

    #[test]
    fn a_file_reads_back_what_was_written() {
        let blob: Vec<u8> = (0_u8..24).collect();
        let packed = pack_vectors(&head(), &blob);
        assert_eq!(unpack_vectors(&packed), Some((head(), blob)));
    }

    #[test]
    fn a_head_without_hashes_round_trips_and_omits_the_key() {
        let plain = VectorFileHead {
            hashes: None,
            ..head()
        };
        let packed = pack_vectors(&plain, &[1, 2, 3]);
        let json = &packed[LENGTH_BYTES..packed.len() - 3];
        assert!(!String::from_utf8_lossy(json).contains("hashes"));
        assert_eq!(unpack_vectors(&packed), Some((plain, vec![1, 2, 3])));
    }

    #[test]
    fn the_length_prefix_is_little_endian_and_counts_the_head_only() {
        let packed = pack_vectors(&head(), &[9; 5]);
        let length = u32::from_le_bytes(packed[..4].try_into().unwrap()) as usize;
        assert_eq!(packed.len(), 4 + length + 5);
        assert_eq!(&packed[4 + length..], &[9; 5]);
    }

    #[test]
    fn a_file_cut_inside_its_head_is_refused() {
        let packed = pack_vectors(&head(), &[0; 12]);
        assert_eq!(unpack_vectors(&packed[..10]), None);
        assert_eq!(unpack_head(&packed[..10]), None);
    }

    #[test]
    fn a_file_shorter_than_its_length_prefix_is_refused() {
        assert_eq!(unpack_vectors(&[1, 0]), None);
        assert_eq!(unpack_vectors(&[]), None);
    }

    #[test]
    fn a_head_that_is_not_json_is_refused() {
        let mut file = 4_u32.to_le_bytes().to_vec();
        file.extend_from_slice(b"nope");
        assert_eq!(unpack_vectors(&file), None);
    }

    #[test]
    fn a_length_prefix_past_the_end_is_refused() {
        let mut file = u32::MAX.to_le_bytes().to_vec();
        file.extend_from_slice(b"{}");
        assert_eq!(unpack_vectors(&file), None);
    }
}
