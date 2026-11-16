//! The Overleaf projects a report tab lists (wf-core `overleaf::project_list`). Parity with
//! `apps/web/src/features/report/lib/parts.ts`. The order is left to the caller:
//! the TypeScript side sorts with `localeCompare`, which decides how names order.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// A project on the signed-in Overleaf account.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct AccountProject {
    /// Overleaf project id.
    pub id: String,
    /// Project name on Overleaf.
    pub name: String,
}

/// A WeaveForge report linked to an Overleaf project.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct LinkedRef {
    /// Overleaf project id the report links to.
    pub overleaf_project_id: String,
    /// Report title.
    pub title: String,
}

/// One merged row. `linked_index` is the position in the linked list of the first report that
/// points at this project, or `None` when no report does.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedProject {
    /// Overleaf project id.
    pub id: String,
    /// Account name, or the report title when not in the account.
    pub name: String,
    /// Whether the signed-in account has this project.
    pub in_account: bool,
    /// Index of the first linked report pointing here, if any.
    pub linked_index: Option<usize>,
}

/// Account projects and linked reports as one list, matched on the Overleaf id. An account
/// project keeps its place when it repeats (the later entry wins). A linked report with no account
/// project becomes a row named by its title. Each project takes the first report that points at it.
#[must_use]
pub fn merge(account: &[AccountProject], linked: &[LinkedRef]) -> Vec<MergedProject> {
    let mut rows: Vec<MergedProject> = Vec::new();
    let mut position: HashMap<&str, usize> = HashMap::new();
    for project in account {
        let row = MergedProject {
            id: project.id.clone(),
            name: project.name.clone(),
            in_account: true,
            linked_index: None,
        };
        if let Some(&at) = position.get(project.id.as_str()) {
            rows[at] = row;
        } else {
            let _ = position.insert(project.id.as_str(), rows.len());
            rows.push(row);
        }
    }
    for (index, report) in linked.iter().enumerate() {
        if let Some(&at) = position.get(report.overleaf_project_id.as_str()) {
            if rows[at].linked_index.is_none() {
                rows[at].linked_index = Some(index);
            }
        } else {
            let _ = position.insert(report.overleaf_project_id.as_str(), rows.len());
            rows.push(MergedProject {
                id: report.overleaf_project_id.clone(),
                name: report.title.clone(),
                in_account: false,
                linked_index: Some(index),
            });
        }
    }
    rows
}

/// Whether a row matches the search: the query is trimmed and compared case-insensitively against
/// the name and the linked title. An empty query matches every row.
#[must_use]
pub fn matches_query(name: &str, linked_title: Option<&str>, query: &str) -> bool {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return true;
    }
    name.to_lowercase().contains(&needle)
        || linked_title.is_some_and(|title| title.to_lowercase().contains(&needle))
}

/// Whether a row is shown when some account projects are picked: linked rows always, other rows
/// only if their id is picked.
#[must_use]
pub fn is_shown(has_link: bool, id: &str, picked: &[String]) -> bool {
    has_link || picked.iter().any(|picked_id| picked_id == id)
}

#[cfg(test)]
mod tests {
    use super::{AccountProject, LinkedRef, is_shown, matches_query, merge};

    fn account(id: &str, name: &str) -> AccountProject {
        AccountProject {
            id: id.to_owned(),
            name: name.to_owned(),
        }
    }

    fn linked(id: &str, title: &str) -> LinkedRef {
        LinkedRef {
            overleaf_project_id: id.to_owned(),
            title: title.to_owned(),
        }
    }

    #[test]
    fn a_linked_account_project_is_one_row_with_its_report() {
        let rows = merge(&[account("p1", "Thesis")], &[linked("p1", "Report")]);
        assert_eq!(rows.len(), 1);
        assert!(rows[0].in_account);
        assert_eq!(rows[0].name, "Thesis");
        assert_eq!(rows[0].linked_index, Some(0));
    }

    #[test]
    fn a_report_without_an_account_project_is_named_by_its_title() {
        let rows = merge(&[account("p1", "Thesis")], &[linked("p9", "Old copy")]);
        assert_eq!(rows.len(), 2);
        assert!(!rows[1].in_account);
        assert_eq!(rows[1].id, "p9");
        assert_eq!(rows[1].name, "Old copy");
        assert_eq!(rows[1].linked_index, Some(0));
    }

    #[test]
    fn the_first_report_for_a_project_wins() {
        let rows = merge(
            &[account("p1", "Thesis")],
            &[linked("p1", "First"), linked("p1", "Second")],
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].linked_index, Some(0));
    }

    #[test]
    fn a_repeated_account_project_keeps_its_place_and_the_later_name() {
        let rows = merge(
            &[
                account("p1", "Old"),
                account("p2", "Two"),
                account("p1", "New"),
            ],
            &[],
        );
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, "p1");
        assert_eq!(rows[0].name, "New");
    }

    #[test]
    fn query_matches_name_or_linked_title_ignoring_case_and_spaces() {
        assert!(matches_query("Thesis", None, "  THE "));
        assert!(matches_query("Thesis", Some("Report"), "report"));
        assert!(!matches_query("Thesis", None, "report"));
        assert!(matches_query("Thesis", None, "   "));
    }

    #[test]
    fn linked_rows_always_show_and_others_only_when_picked() {
        let picked = vec!["p2".to_owned()];
        assert!(is_shown(true, "p1", &picked));
        assert!(is_shown(false, "p2", &picked));
        assert!(!is_shown(false, "p1", &picked));
    }
}
