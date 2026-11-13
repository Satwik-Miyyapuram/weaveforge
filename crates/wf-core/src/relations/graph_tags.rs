//! Graph tag helpers, ported from `apps/web/src/features/relations/application/graph-tags.ts`.
//!
//! A note's tags are the hashtags in its title and body, as
//! [`extract_hashtags`](crate::papers::paper::extract_hashtags) reads them.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use serde::Deserialize;

use crate::papers::paper::extract_hashtags;

/// The part of a paper the graph tags read: its tag list.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TaggedPaper {
    /// Tags as stored on the paper.
    pub tags: Vec<String>,
}

/// The part of a note the graph tags read: its title and body.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TaggedNote {
    /// Note title; hashtags here count.
    pub title: String,
    /// Note body; hashtags here count.
    pub body: String,
}

/// The part of a reading list the graph tags read: its name.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NamedList {
    /// List name, lowercased when shown as a tag.
    pub name: String,
}

/// The hashtags of one note, in the order they appear.
#[must_use]
pub fn note_tags(note: &TaggedNote) -> Vec<String> {
    extract_hashtags(Some(&format!("{}\n{}", note.title, note.body)))
}

/// Every tag the graph can filter by, sorted in UTF-16 order: paper tags, note
/// hashtags and, when `include_lists`, list names lowercased.
#[must_use]
pub fn graph_tag_names(
    papers: &[TaggedPaper],
    notes: &[TaggedNote],
    lists: &[NamedList],
    include_lists: bool,
) -> Vec<String> {
    let mut set: HashSet<String> = HashSet::new();
    for paper in papers {
        set.extend(paper.tags.iter().cloned());
    }
    for note in notes {
        set.extend(note_tags(note));
    }
    if include_lists {
        set.extend(lists.iter().map(|list| list.name.to_lowercase()));
    }
    let mut names: Vec<String> = set.into_iter().collect();
    names.sort_by(|a, b| utf16_cmp(a, b));
    names
}

/// The tags seen most often beside `name`: each paper and note counts a tag once
/// per paper or note. Top `limit`, most first; ties keep first-seen order.
#[must_use]
pub fn related_concepts(
    name: &str,
    papers: &[TaggedPaper],
    notes: &[TaggedNote],
    limit: usize,
) -> Vec<(String, u32)> {
    let mut counts: Vec<(String, u32)> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut count = |tags: &[String]| {
        for tag in tags {
            if tag == name {
                continue;
            }
            match index.get(tag) {
                Some(&i) => counts[i].1 += 1,
                None => {
                    let _ = index.insert(tag.clone(), counts.len());
                    counts.push((tag.clone(), 1));
                }
            }
        }
    };
    for paper in papers {
        let mut seen: HashSet<&str> = HashSet::new();
        let unique: Vec<String> = paper
            .tags
            .iter()
            .filter(|t| seen.insert(t.as_str()))
            .cloned()
            .collect();
        count(&unique);
    }
    for note in notes {
        count(&note_tags(note));
    }
    counts.sort_by_key(|c| std::cmp::Reverse(c.1));
    counts.truncate(limit);
    counts
}

/// Indices of the notes carrying any of `tags` as a whole hashtag (`#ml` is not
/// `#mlops`). All indices when `tags` is empty.
#[must_use]
pub fn notes_tagged(notes: &[TaggedNote], tags: &[String]) -> Vec<usize> {
    if tags.is_empty() {
        return (0..notes.len()).collect();
    }
    let wanted: HashSet<&str> = tags.iter().map(String::as_str).collect();
    notes
        .iter()
        .enumerate()
        .filter(|(_, note)| note_tags(note).iter().any(|t| wanted.contains(t.as_str())))
        .map(|(i, _)| i)
        .collect()
}

/// UTF-16 code unit order, as JavaScript compares strings.
#[must_use]
pub fn utf16_cmp(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paper(tags: &[&str]) -> TaggedPaper {
        TaggedPaper {
            tags: tags.iter().map(|t| (*t).to_owned()).collect(),
        }
    }

    fn note(title: &str, body: &str) -> TaggedNote {
        TaggedNote {
            title: title.to_owned(),
            body: body.to_owned(),
        }
    }

    #[test]
    fn names_are_sorted_and_unique() {
        let papers = [paper(&["ml", "Zeta"])];
        let notes = [note("#mlops", "about #ml")];
        let lists = [NamedList {
            name: "Reading".to_owned(),
        }];
        assert_eq!(
            graph_tag_names(&papers, &notes, &lists, false),
            vec!["Zeta", "ml", "mlops"]
        );
        assert_eq!(
            graph_tag_names(&papers, &notes, &lists, true),
            vec!["Zeta", "ml", "mlops", "reading"]
        );
    }

    #[test]
    fn related_counts_once_per_item_and_skips_self() {
        let papers = [paper(&["ml", "ml", "nlp"]), paper(&["ml", "cv"])];
        let notes = [note("#ml #cv", "")];
        let out = related_concepts("ml", &papers, &notes, 12);
        assert_eq!(out, vec![("cv".to_owned(), 2), ("nlp".to_owned(), 1)]);
        assert_eq!(related_concepts("ml", &papers, &notes, 1).len(), 1);
    }

    #[test]
    fn notes_match_whole_tags() {
        let notes = [note("#mlops", ""), note("#ml", "")];
        assert_eq!(notes_tagged(&notes, &[]), vec![0, 1]);
        assert_eq!(notes_tagged(&notes, &["ml".to_owned()]), vec![1]);
        assert!(notes_tagged(&notes, &["cv".to_owned()]).is_empty());
    }
}
