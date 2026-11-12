//! Joins a Zotero pull's attachments, annotations and notes to the papers they belong to.
//!
//! Output keeps first-seen order, the way the JS `Map`s it replaces did, so the
//! TypeScript caller can rebuild the same maps.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::papers::zotero_annotations::{
    ZoteroAnnotation, ZoteroItemRow, annotation_from_item, is_pdf_attachment, item_key,
    note_from_item, pick_main_pdf,
};

/// What the join produced. Pairs are `[key, value]` in first-seen order.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroPullJoin {
    /// Paper key to its annotations and notes.
    pub by_paper: Vec<(String, Vec<ZoteroAnnotation>)>,
    /// Paper key to the attachment key the paper's marks belong on.
    pub attachments: Vec<(String, String)>,
    /// One line per paper with several PDFs, for the log.
    pub choices: Vec<String>,
}

/// Joins attachments, annotations and notes to paper keys.
///
/// `allowed_paper_keys` gates parents when a collection is in scope; `None` means
/// the whole library.
#[must_use]
pub fn join_zotero_pull(
    attachments: &[ZoteroItemRow],
    annotations: &[ZoteroItemRow],
    notes: &[ZoteroItemRow],
    allowed_paper_keys: Option<&HashSet<String>>,
) -> ZoteroPullJoin {
    let allowed = |paper: &str| allowed_paper_keys.is_none_or(|set| set.contains(paper));

    // Pass 1: attachment -> parent paper key, and the PDFs each paper has.
    let mut attach_to_paper: HashMap<String, String> = HashMap::new();
    let mut pdfs_by_paper: OrderedMap<Vec<&ZoteroItemRow>> = OrderedMap::default();
    for it in attachments {
        let Some(key) = item_key(it).filter(|k| !k.is_empty()) else {
            continue;
        };
        let Some(paper) = parent_of(it) else {
            continue;
        };
        if !allowed(paper) {
            continue;
        }
        let _ = attach_to_paper.insert(key, paper.to_string());
        if is_pdf_attachment(it) {
            match pdfs_by_paper.get_mut(paper) {
                Some(list) => list.push(it),
                None => pdfs_by_paper.insert(paper.to_string(), vec![it]),
            }
        }
    }

    let mut paper_pdf: OrderedMap<String> = OrderedMap::default();
    let mut choices: Vec<String> = Vec::new();
    for (paper, pdfs) in pdfs_by_paper.entries() {
        let main = pick_main_pdf(&pdfs.iter().map(|p| (*p).clone()).collect::<Vec<_>>());
        if let Some(main) = &main {
            paper_pdf.insert(paper.clone(), main.clone());
        }
        if pdfs.len() > 1 {
            let keys: Vec<String> = pdfs
                .iter()
                .map(|p| item_key(p).unwrap_or_default())
                .collect();
            // The TS template rendered a missing main as the text "undefined".
            let main_text = main.as_deref().unwrap_or("undefined");
            choices.push(format!("{paper}: {main_text} of {}", keys.join(", ")));
        }
    }

    // Pass 2: annotations, resolved to their paper via the attachment map.
    // The PDF the reader already annotated in Zotero wins over the picked one.
    let mut annotated_pdf: OrderedMap<String> = OrderedMap::default();
    let mut by_paper: OrderedMap<Vec<ZoteroAnnotation>> = OrderedMap::default();
    for it in annotations {
        let Some(att_key) = parent_of(it) else {
            continue;
        };
        let Some(paper) = attach_to_paper.get(att_key) else {
            continue;
        };
        if !annotated_pdf.contains(paper) {
            annotated_pdf.insert(paper.clone(), att_key.to_string());
        }
        push_into(&mut by_paper, paper, annotation_from_item(it));
    }

    // Notes are direct child items of a paper.
    for it in notes {
        let Some(paper) = parent_of(it) else {
            continue;
        };
        if !allowed(paper) {
            continue;
        }
        let Some(note) = note_from_item(it) else {
            continue;
        };
        push_into(&mut by_paper, paper, note);
    }

    // `new Map([...paperPdf, ...annotatedPdf])`: a later entry overwrites the value
    // but keeps the first position.
    let mut attachments_out: OrderedMap<String> = paper_pdf;
    for (paper, att) in annotated_pdf.into_entries() {
        attachments_out.insert(paper, att);
    }

    ZoteroPullJoin {
        by_paper: by_paper.into_entries(),
        attachments: attachments_out.into_entries(),
        choices,
    }
}

fn parent_of(it: &ZoteroItemRow) -> Option<&str> {
    it.data
        .as_ref()
        .and_then(|d| d.parent_item.as_deref())
        .filter(|p| !p.is_empty())
}

fn push_into(map: &mut OrderedMap<Vec<ZoteroAnnotation>>, paper: &str, value: ZoteroAnnotation) {
    match map.get_mut(paper) {
        Some(list) => list.push(value),
        None => map.insert(paper.to_string(), vec![value]),
    }
}

/// A string-keyed map that remembers first-insertion order.
#[derive(Debug)]
struct OrderedMap<V> {
    index: HashMap<String, usize>,
    entries: Vec<(String, V)>,
}

impl<V> Default for OrderedMap<V> {
    fn default() -> Self {
        Self {
            index: HashMap::new(),
            entries: Vec::new(),
        }
    }
}

impl<V> OrderedMap<V> {
    fn contains(&self, key: &str) -> bool {
        self.index.contains_key(key)
    }

    fn get_mut(&mut self, key: &str) -> Option<&mut V> {
        let at = *self.index.get(key)?;
        self.entries.get_mut(at).map(|(_, v)| v)
    }

    /// Sets the value; an existing key keeps its position.
    fn insert(&mut self, key: String, value: V) {
        if let Some(&at) = self.index.get(&key) {
            self.entries[at].1 = value;
        } else {
            let _ = self.index.insert(key.clone(), self.entries.len());
            self.entries.push((key, value));
        }
    }

    fn entries(&self) -> impl Iterator<Item = (&String, &V)> {
        self.entries.iter().map(|(k, v)| (k, v))
    }

    fn into_entries(self) -> Vec<(String, V)> {
        self.entries
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::join_zotero_pull;
    use crate::papers::zotero_annotations::ZoteroItemRow;

    fn item(json: &str) -> ZoteroItemRow {
        serde_json::from_str(json).expect("valid item json")
    }

    // it: "pull reports each paper's PDF attachment, preferring the one already annotated"
    #[test]
    fn annotated_pdf_wins_over_the_picked_main_pdf() {
        let attachments = vec![
            item(r#"{"key":"PDF1","data":{"parentItem":"P1","contentType":"application/pdf","title":"Paper"}}"#),
            item(r#"{"key":"PDF2","data":{"parentItem":"P1","contentType":"application/pdf","title":"Other"}}"#),
        ];
        let annotations = vec![item(
            r#"{"key":"A1","data":{"parentItem":"PDF2","annotationType":"highlight","annotationText":"x"}}"#,
        )];
        let out = join_zotero_pull(&attachments, &annotations, &[], None);
        assert_eq!(
            out.attachments,
            vec![("P1".to_string(), "PDF2".to_string())]
        );
        assert_eq!(out.by_paper.len(), 1);
        assert_eq!(out.by_paper[0].0, "P1");
        assert_eq!(out.by_paper[0].1.len(), 1);
    }

    // it: "pull reads item keys given inside data, as the local Zotero API can"
    #[test]
    fn keys_inside_data_join_the_same_as_top_level_keys() {
        let attachments = vec![item(
            r#"{"data":{"key":"PDF9","parentItem":"P9","contentType":"application/pdf"}}"#,
        )];
        let annotations = vec![item(
            r#"{"data":{"key":"A9","parentItem":"PDF9","annotationType":"note","annotationText":"x"}}"#,
        )];
        let out = join_zotero_pull(&attachments, &annotations, &[], None);
        assert_eq!(
            out.attachments,
            vec![("P9".to_string(), "PDF9".to_string())]
        );
        assert_eq!(out.by_paper[0].0, "P9");
    }

    // it: "pull counts a linked PDF with no content type as the paper's PDF"
    #[test]
    fn linked_pdf_without_content_type_is_the_paper_pdf() {
        let attachments = vec![item(
            r#"{"key":"LNK","data":{"parentItem":"P2","title":"paper.pdf","path":"/library/paper.pdf"}}"#,
        )];
        let out = join_zotero_pull(&attachments, &[], &[], None);
        assert_eq!(
            out.attachments,
            vec![("P2".to_string(), "LNK".to_string())]
        );
        assert!(out.choices.is_empty());
    }

    // it: "pull picks the main PDF over a supplement whatever order Zotero lists them in"
    #[test]
    fn main_pdf_beats_supplement_and_logs_the_choice() {
        let supplement = r#"{"key":"SUP","data":{"parentItem":"P3","contentType":"application/pdf","title":"Supplement"}}"#;
        let main = r#"{"key":"MAIN","data":{"parentItem":"P3","contentType":"application/pdf","title":"Full text"}}"#;
        for order in [[supplement, main], [main, supplement]] {
            let attachments: Vec<ZoteroItemRow> = order.iter().map(|s| item(s)).collect();
            let out = join_zotero_pull(&attachments, &[], &[], None);
            assert_eq!(
                out.attachments,
                vec![("P3".to_string(), "MAIN".to_string())]
            );
            assert_eq!(out.choices.len(), 1);
            assert!(out.choices[0].starts_with("P3: MAIN of "), "{:?}", out.choices);
        }
    }

    // it: "pull keys attachments by paper only"
    #[test]
    fn attachments_are_keyed_by_paper_not_by_item() {
        let attachments = vec![
            item(r#"{"key":"PDF5","data":{"parentItem":"P5","contentType":"application/pdf"}}"#),
        ];
        let annotations = vec![item(
            r#"{"key":"A5","data":{"parentItem":"PDF5","annotationType":"highlight","annotationText":"x"}}"#,
        )];
        let out = join_zotero_pull(&attachments, &annotations, &[], None);
        let keys: Vec<&str> = out.attachments.iter().map(|(p, _)| p.as_str()).collect();
        assert_eq!(keys, vec!["P5"]);
    }

    // Collection scope has no separate TS it() title; it is the allowedPaperKeys gate in pass 1.
    #[test]
    fn collection_scope_gates_parents() {
        let attachments = vec![
            item(r#"{"key":"PDFIN","data":{"parentItem":"PIN","contentType":"application/pdf"}}"#),
            item(r#"{"key":"PDFOUT","data":{"parentItem":"POUT","contentType":"application/pdf"}}"#),
        ];
        let allowed: HashSet<String> = ["PIN".to_string()].into_iter().collect();
        let out = join_zotero_pull(&attachments, &[], &[], Some(&allowed));
        assert_eq!(
            out.attachments,
            vec![("PIN".to_string(), "PDFIN".to_string())]
        );
    }
}
