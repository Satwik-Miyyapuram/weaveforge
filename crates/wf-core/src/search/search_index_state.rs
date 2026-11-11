//! Port of the pure part of `apps/web/src/features/search/application/parts-2.ts`:
//! which search kinds a write to a resource type can change. The stale set and its
//! transitions stay in the TS class, because they hold the live index.

use super::query::SearchKind;

use SearchKind::{Annotation, Experiment, List, Log, Milestone, Note, Paper, Section};

/// Resource type to the kinds it can change (TS `KINDS_FOR_RESOURCE`).
///
/// `pdf` is in no entry on purpose: page documents come from extracted text, and
/// `indexPdf` refreshes them. A resource type absent here means a full rebuild.
pub const KINDS_FOR_RESOURCE: &[(&str, &[SearchKind])] = &[
    ("paper", &[Paper, Annotation]),
    ("vault_page", &[Note]),
    ("reading_list", &[List]),
    ("reading_list_item", &[]),
    ("report_section", &[Section]),
    ("experiment", &[Experiment]),
    ("milestone", &[Milestone]),
    ("log_entry", &[Log]),
    ("paper_relation", &[Paper, Note]),
    ("tag", &[Paper]),
    ("paper_tag", &[Paper]),
    ("comment", &[]),
    ("share", &[]),
    ("library_pin", &[]),
    ("citation_alert_track", &[]),
    ("dashboard_layout", &[]),
    ("graph_settings", &[]),
];

/// Kinds a write to `resource_type` can change, or `None` when the type is unmapped
/// (the caller then distrusts the whole index).
#[must_use]
pub fn kinds_for_resource(resource_type: &str) -> Option<Vec<SearchKind>> {
    KINDS_FOR_RESOURCE
        .iter()
        .find(|(name, _)| *name == resource_type)
        .map(|(_, kinds)| kinds.to_vec())
}

/// Every mapped resource type, in table order.
#[must_use]
pub fn resource_types() -> Vec<&'static str> {
    KINDS_FOR_RESOURCE.iter().map(|(name, _)| *name).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mapped_type_names_its_kinds() {
        assert_eq!(kinds_for_resource("vault_page"), Some(vec![Note]));
        assert_eq!(
            kinds_for_resource("paper_relation"),
            Some(vec![Paper, Note])
        );
    }

    #[test]
    fn unmapped_or_empty_string_has_no_entry() {
        assert_eq!(kinds_for_resource("no_such_type"), None);
        assert_eq!(kinds_for_resource(""), None);
    }

    #[test]
    fn unrelated_writes_map_to_no_kinds() {
        assert_eq!(kinds_for_resource("comment"), Some(vec![]));
        assert_eq!(resource_types().len(), KINDS_FOR_RESOURCE.len());
    }
}
