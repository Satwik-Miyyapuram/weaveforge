//! Scoped cache invalidation: which repo caches and screen caches a write clears (wf-core
//! `cache_invalidation`). Ported from `apps/web/src/lib/cache/cache-invalidation-map.ts`.
//!
//! Screens are plain names here. The TS `ScreenId` type does not cross into Rust, so the web
//! screens test keeps checking that every screen is named.

use serde::{Deserialize, Serialize};

/// A kind of record a write can change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ResourceType {
    /// A paper.
    Paper,
    /// A vault page.
    VaultPage,
    /// A reading list.
    ReadingList,
    /// An item on a reading list.
    ReadingListItem,
    /// A logbook entry.
    LogEntry,
    /// A report section.
    ReportSection,
    /// An experiment.
    Experiment,
    /// A milestone.
    Milestone,
    /// A link between two papers.
    PaperRelation,
    /// A tag.
    Tag,
    /// A tag on a paper.
    PaperTag,
    /// A comment.
    Comment,
    /// A share.
    Share,
    /// A library pin.
    LibraryPin,
    /// A citation alert track.
    CitationAlertTrack,
    /// A project.
    Project,
    /// A dashboard layout.
    DashboardLayout,
    /// Graph settings.
    GraphSettings,
}

impl ResourceType {
    /// Every resource type, in map order.
    pub const ALL: [Self; 18] = [
        Self::Paper,
        Self::VaultPage,
        Self::ReadingList,
        Self::ReadingListItem,
        Self::LogEntry,
        Self::ReportSection,
        Self::Experiment,
        Self::Milestone,
        Self::PaperRelation,
        Self::Tag,
        Self::PaperTag,
        Self::Comment,
        Self::Share,
        Self::LibraryPin,
        Self::CitationAlertTrack,
        Self::Project,
        Self::DashboardLayout,
        Self::GraphSettings,
    ];

    /// The wire name, as the app writes it.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Paper => "paper",
            Self::VaultPage => "vault_page",
            Self::ReadingList => "reading_list",
            Self::ReadingListItem => "reading_list_item",
            Self::LogEntry => "log_entry",
            Self::ReportSection => "report_section",
            Self::Experiment => "experiment",
            Self::Milestone => "milestone",
            Self::PaperRelation => "paper_relation",
            Self::Tag => "tag",
            Self::PaperTag => "paper_tag",
            Self::Comment => "comment",
            Self::Share => "share",
            Self::LibraryPin => "library_pin",
            Self::CitationAlertTrack => "citation_alert_track",
            Self::Project => "project",
            Self::DashboardLayout => "dashboard_layout",
            Self::GraphSettings => "graph_settings",
        }
    }

    /// The type with this wire name, or `None` for anything else (prototype keys included).
    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|t| t.name() == name)
    }
}

/// The caches one write clears: the repos of these types, and these screens.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct InvalidationPlan {
    /// Repo caches to clear, besides the written type's own.
    pub repos: Vec<ResourceType>,
    /// Screen caches to clear, by screen name.
    pub screens: Vec<String>,
}

/// One row of the map.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct InvalidationEntry {
    /// The written type.
    pub resource: ResourceType,
    /// What a write of that type clears.
    pub plan: InvalidationPlan,
}

/// The plan for a write of `resource`.
#[must_use]
pub fn plan(resource: ResourceType) -> InvalidationPlan {
    use ResourceType::{
        CitationAlertTrack, Comment, DashboardLayout, Experiment, GraphSettings, LibraryPin,
        LogEntry, Milestone, Paper, PaperRelation, PaperTag, Project, ReadingList, ReadingListItem,
        ReportSection, Share, Tag, VaultPage,
    };
    let (repos, screens): (&[ResourceType], &[&str]) = match resource {
        Paper => (
            &[
                Paper,
                PaperRelation,
                Tag,
                PaperTag,
                ReadingListItem,
                CitationAlertTrack,
            ],
            &["papers", "graph", "lists"],
        ),
        VaultPage => (
            &[VaultPage, PaperRelation, ReadingListItem],
            &["vault", "graph", "lists"],
        ),
        ReadingList => (
            &[ReadingList, ReadingListItem],
            &["lists", "papers", "vault"],
        ),
        ReadingListItem => (
            &[ReadingListItem, ReadingList],
            &["lists", "papers", "vault"],
        ),
        LogEntry => (&[LogEntry], &["logbook"]),
        ReportSection => (&[ReportSection], &["report", "report-overleaf"]),
        Experiment => (&[Experiment], &["experiments"]),
        Milestone => (&[Milestone], &["plan"]),
        PaperRelation => (&[PaperRelation], &["graph"]),
        Tag | PaperTag => (&[Tag, PaperTag, Paper], &["papers", "graph"]),
        Comment => (&[Comment], &[]),
        Share => (&[Share], &["shared-with-me"]),
        LibraryPin => (&[LibraryPin], &["papers", "lists"]),
        CitationAlertTrack => (&[CitationAlertTrack], &["papers", "logbook"]),
        Project => (&[Project], &[]),
        DashboardLayout => (&[DashboardLayout], &[]),
        GraphSettings => (&[GraphSettings], &["graph"]),
    };
    InvalidationPlan {
        repos: repos.to_vec(),
        screens: screens.iter().map(|s| (*s).to_owned()).collect(),
    }
}

/// The whole map, one entry per resource type, in [`ResourceType::ALL`] order.
#[must_use]
pub fn invalidation_map() -> Vec<InvalidationEntry> {
    ResourceType::ALL
        .into_iter()
        .map(|resource| InvalidationEntry {
            resource,
            plan: plan(resource),
        })
        .collect()
}

/// Whether `value` names a resource type the map knows.
#[must_use]
pub fn is_known_resource_type(value: &str) -> bool {
    ResourceType::from_name(value).is_some()
}

/// What one write clears: the repo caches of `repo_types` (the written type first, then the plan's
/// repos, each once) and the screen caches of `screens`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct WriteScope {
    /// Repo caches to clear.
    pub repo_types: Vec<ResourceType>,
    /// Screen caches to clear.
    pub screens: Vec<String>,
}

/// The [`WriteScope`] for a write of `resource`.
#[must_use]
pub fn write_scope(resource: ResourceType) -> WriteScope {
    let plan = plan(resource);
    let mut repo_types = vec![resource];
    for repo in plan.repos {
        if !repo_types.contains(&repo) {
            repo_types.push(repo);
        }
    }
    WriteScope {
        repo_types,
        screens: plan.screens,
    }
}

/// The resource type a realtime `lww` broadcast clears on its own: `Some` only for a non-empty
/// name the map knows. `None` means clear everything.
#[must_use]
pub fn lww_clear_target(resource_type: Option<&str>) -> Option<String> {
    resource_type
        .filter(|name| is_known_resource_type(name))
        .map(str::to_owned)
}

/// The `lww` broadcast payload's `resourceType` for a write: `Some` for a non-empty name, `None`
/// for a payload with no resource type.
#[must_use]
pub fn lww_notify_resource(resource_type: Option<&str>) -> Option<String> {
    resource_type
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_name_round_trips_and_prototype_keys_are_unknown() {
        for t in ResourceType::ALL {
            assert_eq!(ResourceType::from_name(t.name()), Some(t));
            assert!(is_known_resource_type(t.name()));
        }
        for key in ["constructor", "toString", "__proto__", "hasOwnProperty", ""] {
            assert!(!is_known_resource_type(key), "{key}");
        }
    }

    #[test]
    fn map_has_one_entry_per_type() {
        let map = invalidation_map();
        assert_eq!(map.len(), ResourceType::ALL.len());
        for (entry, t) in map.iter().zip(ResourceType::ALL) {
            assert_eq!(entry.resource, t);
        }
    }

    #[test]
    fn a_paper_write_clears_its_neighbours_and_three_screens() {
        let p = plan(ResourceType::Paper);
        assert!(p.repos.contains(&ResourceType::PaperTag));
        assert_eq!(p.screens, ["papers", "graph", "lists"]);
    }

    #[test]
    fn project_and_comment_writes_clear_no_screen() {
        assert!(plan(ResourceType::Project).screens.is_empty());
        assert!(plan(ResourceType::Comment).screens.is_empty());
        assert_eq!(plan(ResourceType::Project).repos, [ResourceType::Project]);
    }

    #[test]
    fn tag_and_paper_tag_share_a_plan() {
        assert_eq!(plan(ResourceType::Tag), plan(ResourceType::PaperTag));
    }

    #[test]
    fn write_scope_json_uses_the_camel_case_name_the_web_reads() {
        let json = serde_json::to_value(write_scope(ResourceType::Project)).unwrap();
        assert!(json.get("repoTypes").is_some(), "{json}");
        assert!(json.get("repo_types").is_none(), "{json}");
    }
}
