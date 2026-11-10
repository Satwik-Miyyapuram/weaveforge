//! Which explorer rows and sections are open (pure rules). A port of the
//! non-storage half of `apps/web/src/features/editor-workspace/application/explorer-state.ts`.
//! The `localStorage` read and write stay in TS.
//!
//! Open sets are ordered lists here: the order is insertion order, matching the
//! JS `Set` iteration order the TS callers persist.

/// The rows that start open: every root the tree has.
#[must_use]
pub fn default_expanded(roots: &[String]) -> Vec<String> {
    unique(roots)
}

/// One explorer section's declaration: its id and whether it starts collapsed.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SectionDecl {
    /// Id.
    pub id: String,
    /// Collapsed by default.
    #[serde(default)]
    pub collapsed_by_default: bool,
}

/// The sections open when nothing is stored: every section not declared collapsed,
/// in declaration order.
#[must_use]
pub fn default_open_sections(sections: &[SectionDecl]) -> Vec<String> {
    sections
        .iter()
        .filter(|section| !section.collapsed_by_default)
        .map(|section| section.id.clone())
        .collect()
}

/// The saved keys, plus any root the record never mentioned, appended in tree
/// order. Saved keys win and keep their position.
#[must_use]
pub fn migrated_expanded(saved: &[String], roots: &[String]) -> Vec<String> {
    let mut out = unique(saved);
    for root in roots {
        if !out.contains(root) {
            out.push(root.clone());
        }
    }
    out
}

/// `keys` with `key` flipped: removed when present, appended when absent.
#[must_use]
pub fn toggle_key(keys: &[String], key: &str) -> Vec<String> {
    let mut out = unique(keys);
    match out.iter().position(|existing| existing == key) {
        Some(index) => {
            let _ = out.remove(index);
        }
        None => out.push(key.to_owned()),
    }
    out
}

/// Whether `key` is in the open set.
#[must_use]
pub fn is_open(keys: &[String], key: &str) -> bool {
    keys.iter().any(|existing| existing == key)
}

/// The string keys of a stored JSON array record.
///
/// `None` when the record is absent, is not valid JSON, or is not an array: the
/// caller then falls back to the defaults. `Some` of an empty list is a real
/// answer (the reader collapsed everything) and must be honoured, not treated as
/// a missing record. Non-string elements are dropped, keeping the order of the rest.
#[must_use]
pub fn parse_explorer_keys(raw: Option<&str>) -> Option<Vec<String>> {
    let parsed: serde_json::Value = serde_json::from_str(raw?).ok()?;
    let items = parsed.as_array()?;
    Some(
        items
            .iter()
            .filter_map(|item| item.as_str().map(str::to_owned))
            .collect(),
    )
}

/// The keys in first-seen order with duplicates dropped, as a JS `Set` would hold them.
fn unique(keys: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(keys.len());
    for key in keys {
        if !out.contains(key) {
            out.push(key.clone());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    #[test]
    fn default_expanded_opens_every_root_in_tree_order() {
        assert_eq!(
            default_expanded(&keys(&["notes", "papers", "logbook"])),
            keys(&["notes", "papers", "logbook"])
        );
    }

    #[test]
    fn migration_appends_roots_the_record_never_mentioned() {
        let saved = keys(&["notes", "papers", "report"]);
        let roots = keys(&["notes", "papers", "report", "logbook", "overleaf"]);
        assert_eq!(
            migrated_expanded(&saved, &roots),
            keys(&["notes", "papers", "report", "logbook", "overleaf"])
        );
    }

    #[test]
    fn migration_keeps_saved_keys_first_and_drops_duplicates() {
        let saved = keys(&["vault_page:a", "notes", "notes"]);
        let roots = keys(&["notes", "papers"]);
        assert_eq!(
            migrated_expanded(&saved, &roots),
            keys(&["vault_page:a", "notes", "papers"])
        );
    }

    #[test]
    fn toggle_removes_a_present_key_and_appends_an_absent_one() {
        let before = keys(&["notes"]);
        let opened = toggle_key(&before, "papers");
        assert_eq!(opened, keys(&["notes", "papers"]));
        assert_eq!(toggle_key(&opened, "notes"), keys(&["papers"]));
        // The input is not mutated.
        assert_eq!(before, keys(&["notes"]));
    }

    #[test]
    fn toggling_twice_is_the_identity() {
        let start = keys(&["notes", "papers"]);
        assert_eq!(toggle_key(&toggle_key(&start, "files"), "files"), start);
    }

    #[test]
    fn parse_keeps_string_elements_in_order() {
        assert_eq!(
            parse_explorer_keys(Some("[1,\"notes\",null,\"papers\"]")),
            Some(keys(&["notes", "papers"]))
        );
    }

    #[test]
    fn parse_treats_an_empty_array_as_a_decision() {
        assert_eq!(parse_explorer_keys(Some("[]")), Some(Vec::new()));
    }

    #[test]
    fn parse_reports_absent_or_unusable_records_as_none() {
        assert_eq!(parse_explorer_keys(None), None);
        assert_eq!(parse_explorer_keys(Some("not json")), None);
        assert_eq!(parse_explorer_keys(Some("{\"notes\":true}")), None);
        assert_eq!(parse_explorer_keys(Some("null")), None);
    }

    #[test]
    fn default_open_sections_skips_collapsed_by_default() {
        let sections = vec![
            SectionDecl {
                id: "files".to_owned(),
                collapsed_by_default: false,
            },
            SectionDecl {
                id: "lists".to_owned(),
                collapsed_by_default: false,
            },
            SectionDecl {
                id: "outline".to_owned(),
                collapsed_by_default: true,
            },
        ];
        assert_eq!(default_open_sections(&sections), keys(&["files", "lists"]));
    }

    #[test]
    fn is_open_reports_membership_only() {
        let open = keys(&["files", "lists"]);
        assert!(is_open(&open, "files"));
        assert!(!is_open(&open, "outline"));
        assert!(!is_open(&[], "files"));
    }
}
