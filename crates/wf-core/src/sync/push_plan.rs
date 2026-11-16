//! Gates the offline-sync engine and puller decide on (`domain/sync-engine.ts` and
//! `domain/puller.ts`): whether a push keeps going, whether unsent rows are checked
//! against the server, and whether refused pulls may be grouped by table.

/// Whether another push round runs. A round that sent nothing, or that the network
/// stopped early, ends the push.
#[must_use]
pub const fn continue_push_round(sent: usize, stopped_early: bool) -> bool {
    sent > 0 && !stopped_early
}

/// Whether unsent local rows are checked against the server: only once an account is
/// set and that check has not yet run on this device.
#[must_use]
pub const fn should_recover_unsent(has_account: bool, resend_checked: bool) -> bool {
    has_account && !resend_checked
}

/// Whether a refused pull may land in a table-wide group: a live row (not a delete),
/// refused on a unique clash, with nothing this device still owes for it.
#[must_use]
pub const fn group_eligible(deleted: bool, unique_clash: bool, pending_ops: usize) -> bool {
    !deleted && unique_clash && pending_ops == 0
}

/// Whether the pull runs after a push. A push the network stopped gets no pull: the
/// pull would fail the same way, and a thrown pull loses the push's report.
#[must_use]
pub const fn should_pull_after_push(stopped_offline: bool) -> bool {
    !stopped_offline
}

/// Whether the cycle fetches another page: the server says more remain and fewer than
/// `max_pages` pages have been pulled this cycle (`page` counts the pulls already made).
#[must_use]
pub const fn should_fetch_next_page(more: bool, page: usize, max_pages: usize) -> bool {
    more && page < max_pages
}

/// Groups the indices of refused rows that share a table, in first-seen table order.
/// A table with one row is left out: a batch of one is not worth a round trip.
#[must_use]
pub fn table_groups(tables: &[String]) -> Vec<Vec<usize>> {
    let mut groups: Vec<(&str, Vec<usize>)> = Vec::new();
    for (index, table) in tables.iter().enumerate() {
        match groups.iter_mut().find(|(name, _)| *name == table.as_str()) {
            Some((_, members)) => members.push(index),
            None => groups.push((table.as_str(), vec![index])),
        }
    }
    groups
        .into_iter()
        .map(|(_, members)| members)
        .filter(|members| members.len() >= 2)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|name| (*name).to_owned()).collect()
    }

    #[test]
    fn push_continues_only_after_a_round_that_sent() {
        assert!(continue_push_round(1, false));
        assert!(!continue_push_round(0, false));
        assert!(!continue_push_round(5, true));
        assert!(!continue_push_round(0, true));
    }

    #[test]
    fn recover_runs_once_for_an_account_that_has_not_checked() {
        assert!(should_recover_unsent(true, false));
        assert!(!should_recover_unsent(true, true));
        assert!(!should_recover_unsent(false, false));
    }

    #[test]
    fn only_live_clashing_rows_with_nothing_owed_group() {
        assert!(group_eligible(false, true, 0));
        assert!(!group_eligible(true, true, 0));
        assert!(!group_eligible(false, false, 0));
        assert!(!group_eligible(false, true, 1));
    }

    #[test]
    fn pull_is_skipped_only_when_the_push_went_offline() {
        assert!(should_pull_after_push(false));
        assert!(!should_pull_after_push(true));
    }

    #[test]
    fn pages_continue_while_more_and_under_the_budget() {
        assert!(should_fetch_next_page(true, 1, 200));
        assert!(should_fetch_next_page(true, 199, 200));
        assert!(!should_fetch_next_page(true, 200, 200));
        assert!(!should_fetch_next_page(false, 1, 200));
    }

    #[test]
    fn table_groups_keep_first_seen_order_and_drop_singletons() {
        let tables = names(&["papers", "notes", "papers", "tags", "notes", "papers"]);
        assert_eq!(table_groups(&tables), vec![vec![0, 2, 5], vec![1, 4]]);
        assert!(table_groups(&names(&["a", "b", "c"])).is_empty());
        assert!(table_groups(&[]).is_empty());
    }
}
