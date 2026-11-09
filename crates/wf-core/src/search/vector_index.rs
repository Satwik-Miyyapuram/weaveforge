//! Brute-force cosine search over unit vectors (TS `packages/core/src/search/vector-index.ts`).
//!
//! No approximate-nearest-neighbour structure: a thesis workspace is thousands of
//! passages, and a full scan runs well inside a keystroke. Vectors sit in one
//! contiguous buffer and are normalized on insert, so a score is a dot product.
//!
//! The byte format written by [`VectorIndex::to_bytes`] is self-describing, so a
//! caller needs no width of its own. Integers are little-endian `u64`:
//!
//! ```text
//! dimensions | count | (id_length | id_utf8) * count | f32 * (count * dimensions)
//! ```

use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashMap};
use std::fmt;

use super::embedding::normalize_vector;

/// One ranked match. `score` is cosine similarity in [-1, 1].
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct VectorHit {
    /// The id the vector was added under.
    pub id: String,
    /// Cosine similarity to the query.
    pub score: f64,
}

/// Why an index operation was refused.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VectorError {
    /// An index needs at least one dimension.
    NoDimensions,
    /// A vector's width is not the index's width.
    Dimensions {
        /// The width the index holds.
        expected: usize,
        /// The width that was passed.
        got: usize,
    },
    /// The flat value list is not `ids * dimensions` long.
    Length {
        /// How many ids came with it.
        ids: usize,
        /// The index width.
        dimensions: usize,
        /// How many values came.
        values: usize,
    },
    /// Stored bytes are not a valid index.
    Malformed(&'static str),
}

impl fmt::Display for VectorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoDimensions => f.write_str("A vector index needs at least one dimension."),
            Self::Dimensions { expected, got } => {
                write!(f, "Vector has {got} dimensions, index holds {expected}.")
            }
            Self::Length {
                ids,
                dimensions,
                values,
            } => write!(
                f,
                "{values} values for {ids} vectors of {dimensions} dimensions."
            ),
            Self::Malformed(reason) => write!(f, "Stored vector index is malformed: {reason}."),
        }
    }
}

impl std::error::Error for VectorError {}

/// A scan candidate, ordered by score then slot, so a heap can keep the best.
#[derive(Clone, Copy, Debug)]
struct Candidate {
    score: f64,
    slot: usize,
}

impl PartialEq for Candidate {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Candidate {}

impl PartialOrd for Candidate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Candidate {
    fn cmp(&self, other: &Self) -> Ordering {
        self.score
            .total_cmp(&other.score)
            .then(self.slot.cmp(&other.slot))
    }
}

/// Dot product in f64, the same accumulation the TS scan used.
fn dot(a: &[f32], b: &[f32]) -> f64 {
    a.iter()
        .zip(b)
        .map(|(x, y)| f64::from(*x) * f64::from(*y))
        .sum()
}

/// Normalized vectors keyed by id, scanned linearly.
#[derive(Debug)]
pub struct VectorIndex {
    dimensions: usize,
    ids: Vec<String>,
    data: Vec<f32>,
    slots: HashMap<String, usize>,
}

impl VectorIndex {
    /// An empty index for vectors `dimensions` wide.
    ///
    /// # Errors
    ///
    /// `NoDimensions` when `dimensions` is zero.
    pub fn new(dimensions: usize) -> Result<Self, VectorError> {
        if dimensions == 0 {
            return Err(VectorError::NoDimensions);
        }
        Ok(Self {
            dimensions,
            ids: Vec::new(),
            data: Vec::new(),
            slots: HashMap::new(),
        })
    }

    /// The width every vector must have.
    #[must_use]
    pub fn dimensions(&self) -> usize {
        self.dimensions
    }

    /// How many vectors are held.
    #[must_use]
    pub fn size(&self) -> usize {
        self.ids.len()
    }

    /// Whether `id` is held.
    #[must_use]
    pub fn has(&self, id: &str) -> bool {
        self.slots.contains_key(id)
    }

    /// A copy of the stored (normalized) vector for `id`, or `None`.
    #[must_use]
    pub fn vector_of(&self, id: &str) -> Option<Vec<f32>> {
        let slot = *self.slots.get(id)?;
        Some(self.slot_values(slot).to_vec())
    }

    /// Every id held, in slot order.
    #[must_use]
    pub fn all_ids(&self) -> Vec<String> {
        self.ids.clone()
    }

    /// Insert or replace `ids[i]` with `values[i * dimensions..]`, normalized.
    /// All or nothing: the length is checked before anything is written.
    ///
    /// # Errors
    ///
    /// `Length` when `values` is not exactly `ids.len() * dimensions` long.
    pub fn add(&mut self, ids: &[String], values: &[f32]) -> Result<(), VectorError> {
        if values.len() != ids.len().saturating_mul(self.dimensions) {
            return Err(VectorError::Length {
                ids: ids.len(),
                dimensions: self.dimensions,
                values: values.len(),
            });
        }
        for (id, vector) in ids.iter().zip(values.chunks_exact(self.dimensions)) {
            self.upsert(id, &normalize_vector(vector));
        }
        Ok(())
    }

    /// Remove by id; unknown ids are ignored. The last vector moves into the
    /// freed slot instead of shifting the rest, since order carries no meaning.
    pub fn remove(&mut self, ids: &[String]) {
        for id in ids {
            let Some(slot) = self.slots.remove(id) else {
                continue;
            };
            self.swap_out(slot);
        }
    }

    /// Drop every vector.
    pub fn clear(&mut self) {
        self.ids.clear();
        self.data.clear();
        self.slots.clear();
    }

    /// Top `limit` by cosine similarity to `query`, best first, ties by slot.
    /// Scores below `min_score` are dropped rather than padding the list.
    ///
    /// # Errors
    ///
    /// `Dimensions` when `query` is not the index's width.
    pub fn search(
        &self,
        query: &[f32],
        limit: usize,
        min_score: f64,
    ) -> Result<Vec<VectorHit>, VectorError> {
        if query.len() != self.dimensions {
            return Err(VectorError::Dimensions {
                expected: self.dimensions,
                got: query.len(),
            });
        }
        if self.ids.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        let probe = normalize_vector(query);
        let mut best = self.best_candidates(&probe, limit, min_score);
        let mut hits: Vec<VectorHit> = best
            .drain()
            .map(|Reverse(candidate)| VectorHit {
                id: self.id_at(candidate.slot),
                score: candidate.score,
            })
            .collect();
        hits.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.id.cmp(&b.id)));
        Ok(hits)
    }

    /// The stored bytes; see the module docs for the layout.
    #[must_use]
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        put_length(&mut out, self.dimensions);
        put_length(&mut out, self.ids.len());
        for id in &self.ids {
            put_length(&mut out, id.len());
            out.extend_from_slice(id.as_bytes());
        }
        for value in &self.data {
            out.extend_from_slice(&value.to_le_bytes());
        }
        out
    }

    /// Rebuild an index from [`VectorIndex::to_bytes`] output.
    ///
    /// # Errors
    ///
    /// `Malformed` for truncated or over-long bytes, a zero width, a non-UTF-8 id
    /// or a repeated id.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, VectorError> {
        let mut reader = Reader { rest: bytes };
        let dimensions = reader.number()?;
        let count = reader.number()?;
        let mut index =
            Self::new(dimensions).map_err(|_| VectorError::Malformed("zero dimensions"))?;
        for _ in 0..count {
            index.push_stored_id(&mut reader)?;
        }
        let value_bytes = count
            .checked_mul(dimensions)
            .and_then(|n| n.checked_mul(4))
            .ok_or(VectorError::Malformed("too many values"))?;
        let raw = reader.take(value_bytes)?;
        if !reader.rest.is_empty() {
            return Err(VectorError::Malformed("trailing bytes"));
        }
        index.data = raw
            .as_chunks::<4>()
            .0
            .iter()
            .map(|chunk| f32::from_le_bytes(*chunk))
            .collect();
        Ok(index)
    }

    fn push_stored_id(&mut self, reader: &mut Reader<'_>) -> Result<(), VectorError> {
        let length = reader.number()?;
        let id = std::str::from_utf8(reader.take(length)?)
            .map_err(|_| VectorError::Malformed("id is not UTF-8"))?;
        if self.slots.contains_key(id) {
            return Err(VectorError::Malformed("duplicate id"));
        }
        let _previous = self.slots.insert(id.to_owned(), self.ids.len());
        self.ids.push(id.to_owned());
        Ok(())
    }

    fn upsert(&mut self, id: &str, vector: &[f32]) {
        if let Some(&slot) = self.slots.get(id) {
            let start = slot * self.dimensions;
            if let Some(target) = self.data.get_mut(start..start + self.dimensions) {
                target.copy_from_slice(vector);
            }
            return;
        }
        let _previous = self.slots.insert(id.to_owned(), self.ids.len());
        self.ids.push(id.to_owned());
        self.data.extend_from_slice(vector);
    }

    /// Frees `slot` by moving the last vector and id into it.
    fn swap_out(&mut self, slot: usize) {
        let dims = self.dimensions;
        let last = self.ids.len() - 1;
        if slot != last {
            self.data
                .copy_within(last * dims..(last + 1) * dims, slot * dims);
        }
        self.data.truncate(last * dims);
        let _removed = self.ids.swap_remove(slot);
        if let Some(moved) = self.ids.get(slot) {
            let _previous = self.slots.insert(moved.clone(), slot);
        }
    }

    /// Bounded min-heap of the best `limit` scores at or above `min_score`.
    fn best_candidates(
        &self,
        probe: &[f32],
        limit: usize,
        min_score: f64,
    ) -> BinaryHeap<Reverse<Candidate>> {
        let mut heap = BinaryHeap::with_capacity(limit.min(self.ids.len()));
        for (slot, vector) in self.data.chunks_exact(self.dimensions).enumerate() {
            let score = dot(vector, probe);
            if score < min_score {
                continue;
            }
            heap.push(Reverse(Candidate { score, slot }));
            if heap.len() > limit {
                let _weakest = heap.pop();
            }
        }
        heap
    }

    fn slot_values(&self, slot: usize) -> &[f32] {
        let start = slot * self.dimensions;
        self.data
            .get(start..start + self.dimensions)
            .unwrap_or_default()
    }

    fn id_at(&self, slot: usize) -> String {
        self.ids.get(slot).cloned().unwrap_or_default()
    }
}

/// Appends `n` as a little-endian `u64`.
fn put_length(out: &mut Vec<u8>, n: usize) {
    out.extend_from_slice(&u64::try_from(n).unwrap_or(u64::MAX).to_le_bytes());
}

/// Cursor over stored bytes; every read is bounds-checked.
struct Reader<'a> {
    rest: &'a [u8],
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], VectorError> {
        let head = self
            .rest
            .get(..n)
            .ok_or(VectorError::Malformed("truncated"))?;
        self.rest = self.rest.get(n..).unwrap_or_default();
        Ok(head)
    }

    fn number(&mut self) -> Result<usize, VectorError> {
        let raw = self.take(8)?;
        let bytes = <[u8; 8]>::try_from(raw).map_err(|_| VectorError::Malformed("truncated"))?;
        usize::try_from(u64::from_le_bytes(bytes))
            .map_err(|_| VectorError::Malformed("number too large"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    /// Adds one vector per `(id, values)` pair to a fresh index of `width`.
    fn index_with(width: usize, rows: &[(&str, &[f32])]) -> VectorIndex {
        let mut index = VectorIndex::new(width).unwrap();
        for (id, values) in rows {
            index.add(&names(&[*id]), values).unwrap();
        }
        index
    }

    #[test]
    fn zero_dimensions_is_refused() {
        assert_eq!(VectorIndex::new(0).unwrap_err(), VectorError::NoDimensions);
    }

    #[test]
    fn nearest_vector_ranks_first() {
        let index = index_with(
            2,
            &[
                ("east", &[1.0, 0.0]),
                ("north", &[0.0, 1.0]),
                ("north-east", &[1.0, 1.0]),
            ],
        );
        let hits = index.search(&[1.0, 0.1], 3, -1.0).unwrap();
        let order: Vec<&str> = hits.iter().map(|hit| hit.id.as_str()).collect();
        assert_eq!(order, ["east", "north-east", "north"]);
        assert!(hits[0].score > 0.99);
    }

    #[test]
    fn magnitude_does_not_decide_ranking_direction_does() {
        let index = index_with(
            2,
            &[("small", &[0.01, 0.0]), ("large-but-off", &[100.0, 100.0])],
        );
        let hits = index.search(&[1.0, 0.0], 1, -1.0).unwrap();
        assert_eq!(hits[0].id, "small");
    }

    #[test]
    fn weak_matches_are_dropped_not_padded() {
        let index = index_with(2, &[("aligned", &[1.0, 0.0]), ("orthogonal", &[0.0, 1.0])]);
        let hits = index.search(&[1.0, 0.0], 10, 0.2).unwrap();
        let order: Vec<&str> = hits.iter().map(|hit| hit.id.as_str()).collect();
        assert_eq!(order, ["aligned"]);
    }

    #[test]
    fn re_adding_an_id_replaces_its_vector() {
        let mut index = index_with(2, &[("a", &[1.0, 0.0])]);
        index.add(&names(&["a"]), &[0.0, 1.0]).unwrap();
        assert_eq!(index.size(), 1);
        let hits = index.search(&[0.0, 1.0], 1, -1.0).unwrap();
        assert_eq!(hits[0].id, "a");
        assert!(hits[0].score > 0.99, "the new vector is what is stored");
    }

    #[test]
    fn removing_one_entry_leaves_the_others_findable() {
        let mut index = index_with(
            2,
            &[("a", &[1.0, 0.0]), ("b", &[0.0, 1.0]), ("c", &[1.0, 1.0])],
        );
        index.remove(&names(&["a"]));
        assert_eq!(index.size(), 2);
        assert!(!index.has("a"));
        let mut ids = index.all_ids();
        ids.sort();
        assert_eq!(ids, ["b", "c"]);
        let hits = index.search(&[0.0, 1.0], 1, -1.0).unwrap();
        assert!(hits[0].score > 0.99, "the moved vector kept its values");
    }

    #[test]
    fn removing_the_last_entry_is_not_a_special_case() {
        let mut index = index_with(2, &[("a", &[1.0, 0.0]), ("b", &[0.0, 1.0])]);
        index.remove(&names(&["b"]));
        assert_eq!(index.all_ids(), ["a"]);
        index.remove(&names(&["a"]));
        assert_eq!(index.size(), 0);
        assert!(index.search(&[1.0, 0.0], 5, -1.0).unwrap().is_empty());
    }

    #[test]
    fn removing_a_missing_id_is_a_no_op() {
        let mut index = index_with(2, &[("a", &[1.0, 0.0])]);
        index.remove(&names(&["nope"]));
        assert_eq!(index.size(), 1);
    }

    #[test]
    fn growing_keeps_every_vector_intact() {
        let mut index = VectorIndex::new(2).unwrap();
        for i in 0_u16..50 {
            let x = f32::from(i + 1);
            let y = f32::from(50 - i);
            index.add(&[format!("id{i}")], &[x, y]).unwrap();
        }
        assert_eq!(index.size(), 50);
        let hits = index
            .search(&[f32::from(38_u16), f32::from(13_u16)], 1, -1.0)
            .unwrap();
        assert_eq!(hits[0].id, "id37");
    }

    #[test]
    fn a_vector_of_the_wrong_width_is_refused_not_truncated() {
        let mut index = VectorIndex::new(3).unwrap();
        assert!(index.add(&names(&["a"]), &[1.0, 0.0]).is_err());
        assert_eq!(index.size(), 0, "a refused add writes nothing");
        index.add(&names(&["a"]), &[1.0, 0.0, 0.0]).unwrap();
        assert!(index.search(&[1.0, 0.0], 1, -1.0).is_err());
    }

    #[test]
    fn a_bulk_add_with_a_short_value_list_writes_nothing() {
        let mut index = VectorIndex::new(2).unwrap();
        let refused = index.add(&names(&["a", "b"]), &[1.0, 0.0, 0.0]);
        assert_eq!(
            refused,
            Err(VectorError::Length {
                ids: 2,
                dimensions: 2,
                values: 3
            })
        );
        assert_eq!(index.size(), 0);
    }

    #[test]
    fn an_index_survives_a_round_trip_through_bytes() {
        let index = index_with(3, &[("a", &[1.0, 0.0, 0.0]), ("b", &[0.0, 1.0, 0.0])]);
        let restored = VectorIndex::from_bytes(&index.to_bytes()).unwrap();
        assert_eq!(restored.dimensions(), 3);
        assert_eq!(restored.size(), 2);
        let hits = restored.search(&[0.0, 1.0, 0.0], 1, -1.0).unwrap();
        assert_eq!(hits[0].id, "b");
    }

    #[test]
    fn a_vector_of_returns_the_stored_unit_vector() {
        let index = index_with(2, &[("a", &[3.0, 4.0])]);
        let stored = index.vector_of("a").unwrap();
        assert!((stored[0] - 0.6).abs() < 1e-6);
        assert!((stored[1] - 0.8).abs() < 1e-6);
        assert!(index.vector_of("missing").is_none());
    }

    #[test]
    fn truncated_bytes_are_rejected() {
        let bytes = index_with(2, &[("a", &[1.0, 0.0])]).to_bytes();
        let cut = &bytes[..bytes.len() - 1];
        assert!(matches!(
            VectorIndex::from_bytes(cut),
            Err(VectorError::Malformed(_))
        ));
    }

    #[test]
    fn trailing_bytes_are_rejected() {
        let mut bytes = index_with(2, &[("a", &[1.0, 0.0])]).to_bytes();
        bytes.push(0);
        assert!(matches!(
            VectorIndex::from_bytes(&bytes),
            Err(VectorError::Malformed(_))
        ));
    }

    #[test]
    fn a_zero_width_header_is_rejected() {
        let mut bytes = Vec::new();
        put_length(&mut bytes, 0);
        put_length(&mut bytes, 0);
        assert!(matches!(
            VectorIndex::from_bytes(&bytes),
            Err(VectorError::Malformed(_))
        ));
    }

    #[test]
    fn a_repeated_id_in_stored_bytes_is_rejected() {
        let mut bytes = Vec::new();
        put_length(&mut bytes, 1);
        put_length(&mut bytes, 2);
        for _ in 0..2 {
            put_length(&mut bytes, 1);
            bytes.push(b'a');
        }
        for value in [1.0_f32, 0.0, 0.0, 1.0] {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        assert!(matches!(
            VectorIndex::from_bytes(&bytes),
            Err(VectorError::Malformed(_))
        ));
    }

    #[test]
    fn clear_empties_the_index() {
        let mut index = index_with(2, &[("a", &[1.0, 0.0])]);
        index.clear();
        assert_eq!(index.size(), 0);
        assert!(!index.has("a"));
    }
}
