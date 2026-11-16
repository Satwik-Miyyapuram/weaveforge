//! Which cached PDFs to drop once the IndexedDB PDF cache is over its entry cap. A port of
//! `apps/web/src/features/reader/application/pdf-cache-eviction.ts`.

use serde::{Deserialize, Serialize};

/// One cached PDF: its key and when it was last written.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CachedPdfAge {
    /// The cache key.
    pub key: String,
    /// Last write time in milliseconds, as JS `updatedAt`.
    pub updated_at: f64,
}

/// The error message for a capacity that is not a positive integer.
pub const INVALID_CAPACITY: &str = "maxEntries must be a positive integer";

/// Keys of the oldest entries beyond `max_entries`, oldest first.
///
/// Ties keep their input order. A NaN timestamp sorts after every number here, where
/// JS would treat it as equal to all of them; timestamps are never NaN in practice.
///
/// # Errors
///
/// Fails with [`INVALID_CAPACITY`] unless `max_entries` is a positive integer.
pub fn pick_keys_to_evict(
    entries: &[CachedPdfAge],
    max_entries: f64,
) -> Result<Vec<String>, &'static str> {
    if !(max_entries.is_finite() && max_entries.fract() == 0.0 && max_entries >= 1.0) {
        return Err(INVALID_CAPACITY);
    }
    if entries.len() as f64 <= max_entries {
        return Ok(Vec::new());
    }
    let mut sorted: Vec<&CachedPdfAge> = entries.iter().collect();
    sorted.sort_by(|a, b| a.updated_at.total_cmp(&b.updated_at));
    // Integer-valued and in [1, len) after the checks above, so the cast is exact and non-negative.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let drop = entries.len() - max_entries as usize;
    Ok(sorted
        .into_iter()
        .take(drop)
        .map(|entry| entry.key.clone())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn age(key: &str, updated_at: f64) -> CachedPdfAge {
        CachedPdfAge {
            key: key.to_owned(),
            updated_at,
        }
    }

    #[test]
    fn drops_oldest_until_within_cap() {
        let entries = [age("a", 1.0), age("b", 3.0), age("c", 2.0)];
        assert_eq!(pick_keys_to_evict(&entries, 2.0), Ok(vec!["a".to_owned()]));
        assert_eq!(
            pick_keys_to_evict(&[age("a", 1.0)], 2.0),
            Ok(Vec::<String>::new())
        );
    }

    #[test]
    fn rejects_invalid_capacity() {
        for capacity in [0.0, -1.0, 1.5, f64::NAN, f64::INFINITY] {
            assert_eq!(
                pick_keys_to_evict(&[], capacity),
                Err(INVALID_CAPACITY),
                "capacity {capacity}"
            );
        }
    }

    #[test]
    fn ties_keep_input_order() {
        let entries = [age("x", 1.0), age("y", 1.0), age("z", 1.0)];
        assert_eq!(
            pick_keys_to_evict(&entries, 1.0),
            Ok(vec!["x".to_owned(), "y".to_owned()])
        );
    }
}
