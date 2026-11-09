//! Tidying a library imported before the import got careful (TS
//! `features/papers/application/library-tidy.ts`, minus the merge). Finds placeholder
//! and filename titles, and papers that are the same paper. Pure: it says what it would
//! change and writes nothing.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

use super::paper::{PaperStatus, normalize_doi};
use super::paper_title::{is_placeholder_title, title_from_file_name, title_key};

/// The fields the tidy-up reads of one paper (a summary, or the full row).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TidyPaper {
    /// Paper id.
    pub id: String,
    /// Stored title.
    pub title: Option<String>,
    /// Stored DOI, as written.
    pub doi: Option<String>,
    /// Stored arXiv id, as written.
    pub arxiv_id: Option<String>,
    /// Import time (ISO 8601): the oldest copy breaks ties.
    pub created_at: String,
    /// Reading status.
    pub status: Option<PaperStatus>,
    /// The reader's summary.
    pub summary: Option<String>,
    /// The reader's rating.
    pub rating: Option<f64>,
    /// When the paper was read.
    pub read_at: Option<String>,
    /// Attached PDF path.
    pub pdf_path: Option<String>,
    /// Tags.
    pub tags: Vec<String>,
    /// Authors.
    pub authors: Vec<String>,
    /// Publication year.
    pub year: Option<f64>,
    /// Venue.
    pub venue: Option<String>,
    /// URL.
    pub url: Option<String>,
    /// Abstract.
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    /// BibTeX entry.
    pub bibtex: Option<String>,
    /// Free-form metadata (annotations are read from here).
    #[cfg_attr(
        feature = "specta",
        specta(type = Option<std::collections::BTreeMap<String, specta_typescript::Unknown>>)
    )]
    pub metadata: Option<serde_json::Map<String, serde_json::Value>>,
}

/// Lookup identifiers for a title fix: what a metadata source can answer for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TitleLookup {
    /// Normalised DOI.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doi: Option<String>,
    /// Trimmed arXiv id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arxiv_id: Option<String>,
}

/// What the tidy-up would do about one paper's title.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TitleFix {
    /// Paper id.
    pub id: String,
    /// The stored title.
    pub current: String,
    /// A title read back out of the stored one (a reference-manager filename).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposed: Option<String>,
    /// The stored title names nothing and the paper has an identifier to look up.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lookup: Option<TitleLookup>,
}

/// Why two papers were grouped, strongest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum DuplicateReason {
    /// The same DOI.
    Doi,
    /// The same arXiv id, any version.
    Arxiv,
    /// The same normalised title, with no DOI clash.
    Title,
}

/// Papers that are the same paper.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct DuplicateGroup {
    /// The copy the others would be merged into.
    pub keep_id: String,
    /// Every paper in the group, the kept one included, in library order.
    pub ids: Vec<String>,
    /// Why they were grouped.
    pub reason: DuplicateReason,
}

/// Zotero's rename adds " 1", " 2" to a second copy's title. Two digits at most.
static COPY_SUFFIX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(.*\S)\s+\d{1,2}$").expect("copy-suffix pattern is valid"));

/// Venues that are preprint servers, not the published version.
static PREPRINT_VENUE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(arxiv|biorxiv|medrxiv|ssrn|preprint|corr|openreview|research ?square)\b")
        .expect("preprint pattern is valid")
});

/// The fix for every paper whose title needs one, with copy suffixes removed where the
/// unnumbered title is another paper's (TS `titleFixes`).
pub fn title_fixes(papers: &[TidyPaper]) -> Vec<TitleFix> {
    let known = known_title_keys(papers);
    papers
        .iter()
        .filter_map(title_fix_for)
        .map(|mut fix| {
            let base = fix
                .proposed
                .as_deref()
                .and_then(|proposed| without_copy_suffix(proposed, &known));
            if let Some(base) = base {
                fix.proposed = Some(base);
            }
            fix
        })
        .collect()
}

/// The fix for one paper's title, or `None` when the title is fine.
///
/// A filename becomes its title when that gives a real one. A placeholder with a DOI or
/// arXiv id is sent to a lookup. A placeholder with neither is still listed, bare.
fn title_fix_for(paper: &TidyPaper) -> Option<TitleFix> {
    let current = paper.title.clone().unwrap_or_default();
    let from_file = title_from_file_name(&current);
    if from_file != current && !is_placeholder_title(Some(&from_file)) {
        return Some(TitleFix {
            id: paper.id.clone(),
            current,
            proposed: Some(from_file),
            lookup: None,
        });
    }
    if !is_placeholder_title(Some(&current)) {
        return None;
    }
    let doi = normalize_doi(paper.doi.as_deref());
    let arxiv_id = paper
        .arxiv_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned);
    let lookup = (doi.is_some() || arxiv_id.is_some()).then_some(TitleLookup { doi, arxiv_id });
    Some(TitleFix {
        id: paper.id.clone(),
        current,
        proposed: None,
        lookup,
    })
}

/// The title without a copy suffix, when what is left is another paper's title in the
/// library: the copy it was numbered against. `None` keeps the title as it is.
fn without_copy_suffix(title: &str, known: &HashSet<String>) -> Option<String> {
    let captures = COPY_SUFFIX.captures(title)?;
    let base = captures.get(1)?.as_str();
    let key = title_key(Some(base))?;
    known.contains(&key).then(|| base.to_owned())
}

fn known_title_keys(papers: &[TidyPaper]) -> HashSet<String> {
    papers
        .iter()
        .filter_map(|paper| title_key(paper.title.as_deref()))
        .collect()
}

/// The key a paper is grouped by title under, with a copy suffix read as above.
fn grouping_key(title: Option<&str>, known: &HashSet<String>) -> Option<String> {
    let title = title.filter(|t| !t.is_empty())?;
    let from_file = title_from_file_name(title);
    if from_file != title {
        if let Some(base) = without_copy_suffix(&from_file, known) {
            return title_key(Some(&base));
        }
    }
    title_key(Some(title))
}

/// An arXiv id without its version and prefix: `arXiv:2101.00001v2` and `2101.00001` are
/// one paper.
fn arxiv_base(id: Option<&str>) -> Option<String> {
    let lowered = id?.trim().to_lowercase();
    let without_prefix = lowered.strip_prefix("arxiv:").unwrap_or(lowered.as_str());
    let base = strip_version(without_prefix);
    (!base.is_empty()).then(|| base.to_owned())
}

/// Drops a trailing `v` plus one or more digits, as `/v\d+$/` does.
fn strip_version(id: &str) -> &str {
    let digits = id.bytes().rev().take_while(u8::is_ascii_digit).count();
    if digits > 0 && id.len() > digits && id[..id.len() - digits].ends_with('v') {
        &id[..id.len() - digits - 1]
    } else {
        id
    }
}

/// Union-find over paper indexes, with the strongest reason and whether a group holds a DOI.
struct Groups {
    parent: Vec<usize>,
    reason_of: HashMap<usize, DuplicateReason>,
    has_doi: HashSet<usize>,
}

impl Groups {
    fn find(&mut self, index: usize) -> usize {
        let mut root = index;
        while self.parent[root] != root {
            root = self.parent[root];
        }
        let mut current = index;
        while self.parent[current] != root {
            let next = self.parent[current];
            self.parent[current] = root;
            current = next;
        }
        root
    }

    fn union(&mut self, a: usize, b: usize, reason: DuplicateReason) {
        let root_a = self.find(a);
        let root_b = self.find(b);
        let best = [
            self.reason_of.get(&root_a).copied(),
            self.reason_of.get(&root_b).copied(),
            Some(reason),
        ]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or(reason);
        if root_a != root_b {
            self.parent[root_b] = root_a;
        }
        self.reason_of.insert(root_a, best);
        if self.has_doi.contains(&root_b) {
            self.has_doi.insert(root_a);
        }
    }
}

/// Unites every pair that shares a key; the first paper holding a key is the anchor.
fn union_by_key(
    groups: &mut Groups,
    papers: &[TidyPaper],
    key: impl Fn(&TidyPaper) -> Option<String>,
    reason: DuplicateReason,
) {
    let mut first: HashMap<String, usize> = HashMap::new();
    for (index, paper) in papers.iter().enumerate() {
        let Some(value) = key(paper).filter(|k| !k.is_empty()) else {
            continue;
        };
        match first.get(&value) {
            Some(&seen) => groups.union(seen, index, reason),
            None => {
                first.insert(value, index);
            }
        }
    }
}

/// Papers that are the same paper: the same DOI, the same arXiv id (any version), or, for
/// papers with neither, the same normalised title (TS `findDuplicateGroups`).
///
/// Grouped transitively. A title match between two groups that both hold a DOI, and
/// different ones, is not a match: a paper and its erratum share a title and are different
/// records.
pub fn find_duplicate_groups(papers: &[TidyPaper]) -> Vec<DuplicateGroup> {
    let mut groups = Groups {
        parent: (0..papers.len()).collect(),
        reason_of: HashMap::new(),
        has_doi: papers
            .iter()
            .enumerate()
            .filter(|(_, paper)| normalize_doi(paper.doi.as_deref()).is_some())
            .map(|(index, _)| index)
            .collect(),
    };
    union_by_key(
        &mut groups,
        papers,
        |paper| normalize_doi(paper.doi.as_deref()),
        DuplicateReason::Doi,
    );
    union_by_key(
        &mut groups,
        papers,
        |paper| arxiv_base(paper.arxiv_id.as_deref()),
        DuplicateReason::Arxiv,
    );

    // Title only groups papers that do not contradict each other by DOI.
    let known = known_title_keys(papers);
    let mut titled: Vec<Vec<usize>> = Vec::new();
    let mut slot: HashMap<String, usize> = HashMap::new();
    for (index, paper) in papers.iter().enumerate() {
        if let Some(key) = grouping_key(paper.title.as_deref(), &known) {
            let at = *slot.entry(key).or_insert_with(|| {
                titled.push(Vec::new());
                titled.len() - 1
            });
            titled[at].push(index);
        }
    }
    for members in &titled {
        for a in 0..members.len() {
            for b in (a + 1)..members.len() {
                let root_a = groups.find(members[a]);
                let root_b = groups.find(members[b]);
                if root_a != root_b
                    && groups.has_doi.contains(&root_a)
                    && groups.has_doi.contains(&root_b)
                {
                    continue;
                }
                groups.union(members[a], members[b], DuplicateReason::Title);
            }
        }
    }

    let mut order: Vec<usize> = Vec::new();
    let mut members_of: HashMap<usize, Vec<usize>> = HashMap::new();
    for index in 0..papers.len() {
        let root = groups.find(index);
        let members = members_of.entry(root).or_default();
        if members.is_empty() {
            order.push(root);
        }
        members.push(index);
    }
    order
        .into_iter()
        .filter_map(|root| {
            let members = &members_of[&root];
            if members.len() < 2 {
                return None;
            }
            let group: Vec<&TidyPaper> = members.iter().map(|&i| &papers[i]).collect();
            let keeper = pick_keeper(&group)?;
            Some(DuplicateGroup {
                keep_id: keeper.id.clone(),
                ids: group.iter().map(|paper| paper.id.clone()).collect(),
                reason: groups
                    .reason_of
                    .get(&root)
                    .copied()
                    .unwrap_or(DuplicateReason::Title),
            })
        })
        .collect()
}

/// Reading progress, the first thing a keeper is judged on (TS `STATUS_PROGRESS`).
fn status_progress(status: Option<PaperStatus>) -> i64 {
    match status {
        None | Some(PaperStatus::ToRead) => 0,
        Some(PaperStatus::Skimmed) => 1,
        Some(PaperStatus::Reading) => 2,
        Some(PaperStatus::Read) => 3,
    }
}

fn non_empty(value: Option<&str>) -> bool {
    value.is_some_and(|s| !s.is_empty())
}

fn trimmed_non_empty(value: Option<&str>) -> bool {
    value.is_some_and(|s| !s.trim().is_empty())
}

/// How much of a copy is the reader's own work (TS `userWorkScore`). Losing any of it is
/// the one thing a merge must not do, so it ranks first.
fn user_work_score(paper: &TidyPaper) -> i64 {
    let annotations = paper
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("annotations"))
        .and_then(serde_json::Value::as_array)
        .map_or(0, |items| items.len().min(20) as i64 * 5);
    status_progress(paper.status) * 100
        + if trimmed_non_empty(paper.summary.as_deref()) {
            60
        } else {
            0
        }
        + if paper.rating.is_some_and(|r| r != 0.0 && !r.is_nan()) {
            30
        } else {
            0
        }
        + if non_empty(paper.read_at.as_deref()) {
            20
        } else {
            0
        }
        + if non_empty(paper.pdf_path.as_deref()) {
            20
        } else {
            0
        }
        + paper.tags.len().min(5) as i64 * 4
        + annotations
}

/// How many of the descriptive fields a copy has filled in (TS `metadataScore`).
fn metadata_score(paper: &TidyPaper) -> usize {
    [
        !is_placeholder_title(paper.title.as_deref()),
        !paper.authors.is_empty(),
        paper.year.is_some(),
        trimmed_non_empty(paper.venue.as_deref()),
        non_empty(paper.doi.as_deref()),
        non_empty(paper.arxiv_id.as_deref()),
        non_empty(paper.url.as_deref()),
        trimmed_non_empty(paper.abstract_text.as_deref()),
        trimmed_non_empty(paper.bibtex.as_deref()),
    ]
    .into_iter()
    .filter(|present| *present)
    .count()
}

/// The published version: a venue that is not a preprint server (TS `isConferenceCopy`).
pub fn is_conference_copy(paper: &TidyPaper) -> bool {
    paper
        .venue
        .as_deref()
        .map(str::trim)
        .filter(|venue| !venue.is_empty())
        .is_some_and(|venue| !PREPRINT_VENUE.is_match(venue))
}

/// The copy to keep (TS `pickKeeper`): the one holding more of the reader's own work, then
/// more metadata, then the published copy over a preprint, then the oldest.
pub fn pick_keeper<'a>(group: &[&'a TidyPaper]) -> Option<&'a TidyPaper> {
    let mut sorted: Vec<&'a TidyPaper> = group.to_vec();
    sorted.sort_by(|a, b| {
        user_work_score(b)
            .cmp(&user_work_score(a))
            .then_with(|| metadata_score(b).cmp(&metadata_score(a)))
            .then_with(|| is_conference_copy(b).cmp(&is_conference_copy(a)))
            .then_with(|| a.created_at.cmp(&b.created_at))
    });
    sorted.first().copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paper(id: &str) -> TidyPaper {
        TidyPaper {
            id: id.to_owned(),
            title: Some(format!("A sufficiently long distinct paper title {id}")),
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            ..TidyPaper::default()
        }
    }

    fn with_title(id: &str, title: &str) -> TidyPaper {
        TidyPaper {
            title: Some(title.to_owned()),
            ..paper(id)
        }
    }

    fn strs(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    #[test]
    fn a_reference_manager_filename_is_proposed_as_its_title() {
        let fix = title_fix_for(&with_title(
            "a",
            "Goyal et al. - 2017 - Accurate, Large Minibatch SGD.pdf",
        ));
        assert_eq!(
            fix,
            Some(TitleFix {
                id: "a".to_owned(),
                current: "Goyal et al. - 2017 - Accurate, Large Minibatch SGD.pdf".to_owned(),
                proposed: Some("Accurate, Large Minibatch SGD".to_owned()),
                lookup: None,
            })
        );
    }

    #[test]
    fn a_placeholder_with_an_identifier_is_sent_to_a_lookup_one_without_is_listed_bare() {
        let with_doi = title_fix_for(&TidyPaper {
            doi: Some("https://doi.org/10.1/X".to_owned()),
            ..with_title("a", "Catalog Page")
        });
        assert_eq!(
            with_doi,
            Some(TitleFix {
                id: "a".to_owned(),
                current: "Catalog Page".to_owned(),
                proposed: None,
                lookup: Some(TitleLookup {
                    doi: Some("10.1/x".to_owned()),
                    arxiv_id: None,
                }),
            })
        );
        let bare = title_fix_for(&with_title("b", "SAGE PDF Full Text"));
        assert_eq!(
            bare,
            Some(TitleFix {
                id: "b".to_owned(),
                current: "SAGE PDF Full Text".to_owned(),
                proposed: None,
                lookup: None,
            })
        );
    }

    #[test]
    fn a_real_title_needs_no_fix_and_title_fixes_lists_only_the_ones_that_do() {
        let good = with_title("good", "Full Text Search at Scale");
        assert_eq!(title_fix_for(&good), None);
        let bad = with_title("bad", "Snapshot");
        let ids: Vec<String> = title_fixes(&[good, bad])
            .into_iter()
            .map(|fix| fix.id)
            .collect();
        assert_eq!(ids, strs(&["bad"]));
    }

    #[test]
    fn duplicates_group_by_doi_by_arxiv_id_across_versions_and_transitively_by_title() {
        let a = TidyPaper {
            doi: Some("10.5/abc".to_owned()),
            ..paper("a")
        };
        let b = TidyPaper {
            doi: Some("https://doi.org/10.5/ABC".to_owned()),
            ..paper("b")
        };
        let c = TidyPaper {
            arxiv_id: Some("2101.00001v1".to_owned()),
            ..paper("c")
        };
        let d = TidyPaper {
            arxiv_id: Some("arXiv:2101.00001v3".to_owned()),
            ..paper("d")
        };
        let e = TidyPaper {
            title: Some("Attention Is All You Need, Really".to_owned()),
            doi: Some("10.5/abc".to_owned()),
            ..paper("e")
        };
        let f = with_title("f", "attention is all you need — really!");
        let groups = find_duplicate_groups(&[a, b, c, d, e, f, paper("g")]);
        assert_eq!(groups.len(), 2);
        let by_doi = groups
            .iter()
            .find(|group| group.ids.contains(&"a".to_owned()))
            .expect("the DOI group");
        assert_eq!(by_doi.ids, strs(&["a", "b", "e", "f"]));
        assert_eq!(by_doi.reason, DuplicateReason::Doi);
        let by_arxiv = groups
            .iter()
            .find(|group| group.ids.contains(&"c".to_owned()))
            .expect("the arXiv group");
        assert_eq!(by_arxiv.ids, strs(&["c", "d"]));
        assert_eq!(by_arxiv.reason, DuplicateReason::Arxiv);
    }

    #[test]
    fn a_shared_title_with_two_different_dois_is_not_a_duplicate() {
        let title = "On the Measure of Intelligence in Machines";
        let groups = find_duplicate_groups(&[
            TidyPaper {
                doi: Some("10.1/one".to_owned()),
                ..with_title("p1", title)
            },
            TidyPaper {
                doi: Some("10.1/erratum".to_owned()),
                ..with_title("p2", title)
            },
        ]);
        assert!(groups.is_empty());
    }

    #[test]
    fn a_title_only_copy_does_not_bridge_two_different_dois_into_one_group() {
        let title = "On the Measure of Intelligence in Machines";
        let groups = find_duplicate_groups(&[
            TidyPaper {
                doi: Some("10.1/one".to_owned()),
                ..with_title("a", title)
            },
            with_title("b", title),
            TidyPaper {
                doi: Some("10.1/erratum".to_owned()),
                ..with_title("c", title)
            },
        ]);
        // b joins the first DOI it meets; the erratum stays its own record.
        let ids: Vec<Vec<String>> = groups.into_iter().map(|group| group.ids).collect();
        assert_eq!(ids, vec![strs(&["a", "b"])]);
    }

    #[test]
    fn the_bridge_is_refused_whichever_order_the_copies_come_in() {
        let title = "On the Measure of Intelligence in Machines";
        let groups = find_duplicate_groups(&[
            with_title("b", title),
            TidyPaper {
                doi: Some("10.1/one".to_owned()),
                ..with_title("a", title)
            },
            TidyPaper {
                doi: Some("10.1/erratum".to_owned()),
                ..with_title("c", title)
            },
        ]);
        assert_eq!(groups.len(), 1);
        let ids = &groups[0].ids;
        assert!(!(ids.contains(&"a".to_owned()) && ids.contains(&"c".to_owned())));
    }

    #[test]
    fn a_doi_copy_and_its_title_only_twins_still_group_together() {
        let title = "On the Measure of Intelligence in Machines";
        let groups = find_duplicate_groups(&[
            TidyPaper {
                doi: Some("10.1/one".to_owned()),
                ..with_title("a", title)
            },
            with_title("b", title),
            with_title("c", title),
            TidyPaper {
                doi: Some("10.1/one".to_owned()),
                ..with_title("d", "Unrelated")
            },
        ]);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].ids, strs(&["a", "b", "c", "d"]));
        assert_eq!(groups[0].reason, DuplicateReason::Doi);
    }

    #[test]
    fn placeholder_titles_never_group_papers_by_title() {
        let groups = find_duplicate_groups(&[
            with_title("a", "Catalog Page"),
            with_title("b", "Catalog Page"),
        ]);
        assert!(groups.is_empty());
    }

    #[test]
    fn the_keeper_is_the_copy_with_the_readers_own_work_then_more_metadata_then_the_published_one_then_the_oldest()
     {
        let old = TidyPaper {
            created_at: "2020-01-01T00:00:00Z".to_owned(),
            ..paper("old")
        };
        let read = TidyPaper {
            status: Some(PaperStatus::Read),
            created_at: "2025-01-01T00:00:00Z".to_owned(),
            ..paper("read")
        };
        let pdf = TidyPaper {
            pdf_path: Some("x.pdf".to_owned()),
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            ..paper("pdf")
        };
        let keeper_id = |group: &[&TidyPaper]| pick_keeper(group).map(|p| p.id.clone());
        assert_eq!(keeper_id(&[&old, &pdf, &read]).as_deref(), Some("read"));
        assert_eq!(keeper_id(&[&old, &pdf]).as_deref(), Some("pdf"));

        let noted = TidyPaper {
            summary: Some("My take".to_owned()),
            created_at: "2026-02-01T00:00:00Z".to_owned(),
            ..paper("noted")
        };
        let rich = TidyPaper {
            doi: Some("10.1/x".to_owned()),
            year: Some(2024.0),
            authors: strs(&["A B"]),
            abstract_text: Some("…".to_owned()),
            venue: Some("NeurIPS".to_owned()),
            ..paper("rich")
        };
        // User work beats metadata, and more metadata beats age.
        assert_eq!(keeper_id(&[&rich, &noted]).as_deref(), Some("noted"));
        assert_eq!(keeper_id(&[&old, &rich]).as_deref(), Some("rich"));

        let preprint = TidyPaper {
            year: Some(2023.0),
            venue: Some("arXiv".to_owned()),
            created_at: "2020-01-01T00:00:00Z".to_owned(),
            ..paper("preprint")
        };
        let published = TidyPaper {
            year: Some(2023.0),
            venue: Some("ICML 2023".to_owned()),
            created_at: "2024-01-01T00:00:00Z".to_owned(),
            ..paper("published")
        };
        // The published version beats a preprint at equal metadata.
        assert_eq!(
            keeper_id(&[&preprint, &published]).as_deref(),
            Some("published")
        );

        let twin = TidyPaper {
            id: "twin".to_owned(),
            created_at: "2021-01-01T00:00:00Z".to_owned(),
            ..old.clone()
        };
        assert_eq!(keeper_id(&[&twin, &old]).as_deref(), Some("old"));
    }

    #[test]
    fn zoteros_copy_number_is_dropped_only_when_the_unnumbered_title_is_another_papers() {
        let title =
            "Nonparametric Variational Auto-Encoders for Hierarchical Representation Learning";
        let real = TidyPaper {
            doi: Some("10.1109/iccv.2017.545".to_owned()),
            ..with_title("real", title)
        };
        let first = with_title("first", &format!("Goyal et al. - 2017 - {title}.pdf"));
        let second = with_title("second", &format!("Goyal et al. - 2017 - {title} 1.pdf"));
        let llama = with_title(
            "llama",
            "Touvron et al. - 2023 - Llama 2 Open Foundation and Chat Models 2.pdf",
        );
        let papers = [real, first, second, llama];
        let fixes = title_fixes(&papers);
        let proposed = |id: &str| {
            fixes
                .iter()
                .find(|fix| fix.id == id)
                .and_then(|fix| fix.proposed.clone())
        };
        assert_eq!(proposed("second").as_deref(), Some(title));
        assert_eq!(
            proposed("llama").as_deref(),
            Some("Llama 2 Open Foundation and Chat Models 2"),
            "no other paper by that name"
        );

        let groups = find_duplicate_groups(&papers);
        let ids: Vec<Vec<String>> = groups.into_iter().map(|group| group.ids).collect();
        assert_eq!(ids, vec![strs(&["real", "first", "second"])]);
    }
}
