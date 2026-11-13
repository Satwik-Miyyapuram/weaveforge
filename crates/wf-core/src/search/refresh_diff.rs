//! Partial-refresh planning for the search index (TS `refresh-diff.ts`).
//!
//! A document is re-tokenised only when its print (the caller's serialisation
//! of the whole document, degree included) differs from the one remembered
//! last time, or when it was not held. Prints are opaque strings here.

use std::collections::{HashMap, HashSet};

/// A document id with its print.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PrintEntry {
    /// Document id.
    pub id: String,
    /// The document's print from the last refresh.
    pub print: String,
}

/// What a partial refresh must touch, and the prints to remember after it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RefreshDiff {
    /// Held ids with no fresh document: deleted since the last refresh.
    pub remove: Vec<String>,
    /// Indices into the fresh input that are new, changed, or not provably
    /// unchanged.
    #[cfg_attr(feature = "specta", specta(type = Vec<u32>))]
    pub add: Vec<usize>,
    /// Prints after the refresh. Fresh ids keep their place, new ones follow.
    pub prints: Vec<PrintEntry>,
}

/// Compare a refreshed kind's fresh documents with what the index holds.
///
/// `prints` are the prints last stored, `held` the ids the index holds for the
/// kind, and `fresh` the current documents with their prints. A fresh document
/// is added unless it is held and its print is unchanged. Held ids with no
/// fresh document are removed, along with their prints.
#[must_use]
pub fn diff_refresh(prints: &[PrintEntry], held: &[String], fresh: &[PrintEntry]) -> RefreshDiff {
    let previous: HashMap<&str, &str> = prints
        .iter()
        .map(|p| (p.id.as_str(), p.print.as_str()))
        .collect();
    let held_set: HashSet<&str> = held.iter().map(String::as_str).collect();
    let fresh_ids: HashSet<&str> = fresh.iter().map(|doc| doc.id.as_str()).collect();

    let add = fresh
        .iter()
        .enumerate()
        .filter(|(_, doc)| {
            !(held_set.contains(doc.id.as_str())
                && previous.get(doc.id.as_str()) == Some(&doc.print.as_str()))
        })
        .map(|(index, _)| index)
        .collect();

    let remove: Vec<String> = held
        .iter()
        .filter(|id| !fresh_ids.contains(id.as_str()))
        .cloned()
        .collect();

    let mut next: Vec<PrintEntry> = prints.to_vec();
    let mut slot: HashMap<String, usize> = next
        .iter()
        .enumerate()
        .map(|(at, p)| (p.id.clone(), at))
        .collect();
    for doc in fresh {
        match slot.get(&doc.id) {
            Some(&at) => next[at].print.clone_from(&doc.print),
            None => {
                let _ = slot.insert(doc.id.clone(), next.len());
                next.push(doc.clone());
            }
        }
    }
    let removed: HashSet<&str> = remove.iter().map(String::as_str).collect();
    next.retain(|p| !removed.contains(p.id.as_str()));

    RefreshDiff {
        remove,
        add,
        prints: next,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn print(id: &str, body: &str) -> PrintEntry {
        PrintEntry {
            id: id.into(),
            print: body.into(),
        }
    }

    #[test]
    fn unchanged_held_document_is_skipped() {
        let prints = vec![print("a", "1")];
        let diff = diff_refresh(&prints, &["a".into()], &[print("a", "1")]);
        assert!(diff.add.is_empty());
        assert!(diff.remove.is_empty());
    }

    #[test]
    fn changed_new_and_unheld_documents_are_added() {
        let prints = vec![print("a", "1")];
        let fresh = vec![print("a", "2"), print("b", "9")];
        let diff = diff_refresh(&prints, &["a".into()], &fresh);
        assert_eq!(diff.add, vec![0, 1]);
        let unheld = diff_refresh(&prints, &[], &[print("a", "1")]);
        assert_eq!(unheld.add, vec![0]);
    }

    #[test]
    fn held_ids_without_a_fresh_document_are_removed_and_forgotten() {
        let prints = vec![print("a", "1"), print("gone", "x")];
        let diff = diff_refresh(&prints, &["a".into(), "gone".into()], &[print("a", "1")]);
        assert_eq!(diff.remove, vec!["gone".to_string()]);
        assert_eq!(diff.prints, vec![print("a", "1")]);
    }

    #[test]
    fn prints_track_fresh_documents_after_the_refresh() {
        let prints = vec![print("a", "1")];
        let diff = diff_refresh(&prints, &["a".into()], &[print("a", "2"), print("b", "3")]);
        assert_eq!(diff.prints, vec![print("a", "2"), print("b", "3")]);
    }
}
