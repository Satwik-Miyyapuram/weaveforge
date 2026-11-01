//! Spans of text a cleanup rule must not touch.
//!
//! Port of `packages/core/src/paste/text-range.ts`. Every rule collects ranges
//! first and consults them per match. Offsets are byte offsets into the `&str`.

/// A byte range: `start` inclusive, `end` exclusive.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct TextRange {
    /// Inclusive start offset.
    pub start: usize,
    /// Exclusive end offset.
    pub end: usize,
}

/// Merges overlapping and touching ranges so callers can scan them in order.
#[must_use]
pub fn merge_ranges(ranges: &[TextRange]) -> Vec<TextRange> {
    let mut sorted = ranges.to_vec();
    sorted.sort_by(|a, b| a.start.cmp(&b.start).then(a.end.cmp(&b.end)));
    let mut merged: Vec<TextRange> = Vec::with_capacity(sorted.len());
    for range in sorted {
        if let Some(last) = merged.last_mut().filter(|last| range.start <= last.end) {
            last.end = last.end.max(range.end);
        } else {
            merged.push(range);
        }
    }
    merged
}

/// A merged range list you can ask about in logarithmic time.
///
/// Walking the whole list is quadratic for the many-range case, so the ranges
/// are merged on the way in: sorted and disjoint, a binary search is enough.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RangeIndex {
    merged: Vec<TextRange>,
}

impl RangeIndex {
    /// The merged ranges, sorted and disjoint.
    #[must_use]
    pub fn ranges(&self) -> &[TextRange] {
        &self.merged
    }

    /// True when `[start, end)` touches any indexed range.
    #[must_use]
    pub fn overlaps(&self, start: usize, end: usize) -> bool {
        self.candidate_for(start)
            .is_some_and(|candidate| candidate.start < end)
    }

    /// The range containing `offset`, or `None`.
    #[must_use]
    pub fn find(&self, offset: usize) -> Option<TextRange> {
        self.candidate_for(offset)
            .filter(|candidate| candidate.start <= offset)
    }

    /// The leftmost range that could still reach `offset`.
    fn candidate_for(&self, offset: usize) -> Option<TextRange> {
        let mut low = 0;
        let mut high = self.merged.len();
        while low < high {
            let middle = (low + high) >> 1;
            match self.merged.get(middle) {
                Some(range) if range.end <= offset => low = middle + 1,
                _ => high = middle,
            }
        }
        self.merged.get(low).copied()
    }
}

/// Builds a [`RangeIndex`] over `ranges`, merging them first.
#[must_use]
pub fn index_ranges(ranges: &[TextRange]) -> RangeIndex {
    RangeIndex {
        merged: merge_ranges(ranges),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn range(start: usize, end: usize) -> TextRange {
        TextRange { start, end }
    }

    #[test]
    fn merges_overlapping_and_touching_ranges() {
        let merged = merge_ranges(&[range(5, 9), range(0, 3), range(3, 4), range(8, 12)]);
        assert_eq!(merged, vec![range(0, 4), range(5, 12)]);
    }

    #[test]
    fn contained_range_keeps_the_outer_end() {
        assert_eq!(
            merge_ranges(&[range(0, 10), range(2, 4)]),
            vec![range(0, 10)]
        );
    }

    #[test]
    fn empty_input_gives_no_ranges() {
        assert!(merge_ranges(&[]).is_empty());
        assert!(index_ranges(&[]).ranges().is_empty());
        assert_eq!(index_ranges(&[]).find(0), None);
    }

    #[test]
    fn duplicate_ranges_collapse_to_one() {
        assert_eq!(merge_ranges(&[range(1, 2), range(1, 2)]), vec![range(1, 2)]);
    }

    #[test]
    fn overlaps_is_half_open() {
        let index = index_ranges(&[range(4, 8)]);
        assert!(index.overlaps(0, 5));
        assert!(index.overlaps(7, 9));
        assert!(!index.overlaps(0, 4));
        assert!(!index.overlaps(8, 10));
    }

    #[test]
    fn find_returns_the_containing_range() {
        let index = index_ranges(&[range(2, 5), range(10, 12)]);
        assert_eq!(index.find(2), Some(range(2, 5)));
        assert_eq!(index.find(4), Some(range(2, 5)));
        assert_eq!(index.find(5), None);
        assert_eq!(index.find(0), None);
        assert_eq!(index.find(11), Some(range(10, 12)));
    }
}
