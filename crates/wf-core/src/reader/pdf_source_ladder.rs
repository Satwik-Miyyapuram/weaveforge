//! PDF source-ladder order: which resolvers to try, and in what order. A port of the ordering in
//! `packages/core/src/reader/pdf-source-ladder.ts` (`resolvePdfSource`).
//!
//! Stays in TS: calling each resolver's async `resolve`, trimming the hit, and treating a throw or
//! a miss as "try the next one". The order never changes: callers register cost-bearing sources
//! last, and the plan keeps that registration order.

/// Indexes of the resolvers that support the paper, in registration order.
///
/// `supports[i]` is whether resolver `i` supports the paper. Unsupported resolvers are skipped,
/// so the result is the order in which the TS runner tries them.
#[must_use]
pub fn ladder_order(supports: &[bool]) -> Vec<usize> {
    supports
        .iter()
        .enumerate()
        .filter_map(|(index, &supported)| supported.then_some(index))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::ladder_order;

    #[test]
    fn keeps_registration_order_and_skips_unsupported() {
        assert_eq!(ladder_order(&[true, false, true, true]), vec![0, 2, 3]);
    }

    #[test]
    fn no_supporting_resolver_gives_an_empty_plan() {
        assert_eq!(ladder_order(&[false, false]), Vec::<usize>::new());
        assert_eq!(ladder_order(&[]), Vec::<usize>::new());
    }
}
