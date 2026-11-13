//! Paper counts per tag (TS `PostgrestTagRepository.listWithCounts`). Pure: the app reads the
//! `paper_tags` links in chunks and passes them in; this module only counts.

use std::collections::{HashMap, HashSet};

/// One `paper_tags` row: a paper linked to a tag.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TagPaperLink {
    /// Id of the tag.
    pub tag_id: String,
    /// Id of the linked paper.
    pub paper_id: String,
}

/// For each id in `tag_ids`, in the same order, the number of distinct papers linked to it.
///
/// A paper linked twice counts once. A tag with no links counts `0`. Links to tags that are
/// not in `tag_ids` are ignored.
#[must_use]
pub fn paper_counts_for_tags(tag_ids: &[String], links: &[TagPaperLink]) -> Vec<u32> {
    let mut papers: HashMap<&str, HashSet<&str>> = HashMap::new();
    for link in links {
        let _ = papers
            .entry(link.tag_id.as_str())
            .or_default()
            .insert(link.paper_id.as_str());
    }
    tag_ids
        .iter()
        .map(|id| {
            let distinct = papers.get(id.as_str()).map_or(0, HashSet::len);
            u32::try_from(distinct).unwrap_or(u32::MAX)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(tag: &str, paper: &str) -> TagPaperLink {
        TagPaperLink {
            tag_id: tag.to_owned(),
            paper_id: paper.to_owned(),
        }
    }

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn counts_distinct_papers_per_tag() {
        let links = [
            link("t1", "a"),
            link("t1", "a"),
            link("t1", "b"),
            link("x", "c"),
        ];
        assert_eq!(
            paper_counts_for_tags(&ids(&["t1", "t2"]), &links),
            vec![2, 0]
        );
    }

    #[test]
    fn keeps_the_order_of_tag_ids() {
        let links = [link("t2", "a")];
        assert_eq!(
            paper_counts_for_tags(&ids(&["t2", "t1"]), &links),
            vec![1, 0]
        );
    }

    #[test]
    fn no_links_counts_zero() {
        assert_eq!(paper_counts_for_tags(&ids(&["t1"]), &[]), vec![0]);
    }

    #[test]
    fn no_tags_is_empty() {
        assert!(paper_counts_for_tags(&[], &[link("t1", "a")]).is_empty());
    }
}
