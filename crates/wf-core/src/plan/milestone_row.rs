//! Milestone row mapping (TS `milestone-rows.ts`). A row is a `milestones` row as PostgREST and
//! `pg` return it; both backend providers read the same table, so the mapping lives here once.

use serde::{Deserialize, Serialize};

use super::milestone::{ComputeNeed, Milestone, MilestoneDependency};
use crate::lab_snapshot::MilestoneStatus;

/// A `milestones` row. `dependencies` and `compute` may be `null` in the database.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "MilestoneRowInput"))]
pub struct MilestoneRow {
    /// The milestone's id.
    pub id: String,
    /// The milestone's title.
    pub title: String,
    /// The description, when set.
    pub description: Option<String>,
    /// Current status.
    pub status: MilestoneStatus,
    /// Target date (yyyy-mm-dd), when set.
    pub target_date: Option<String>,
    /// Structured dependencies, or `null`.
    pub dependencies: Option<Vec<MilestoneDependency>>,
    /// Compute needs, or `null`.
    pub compute: Option<Vec<ComputeNeed>>,
    /// When the milestone was created, as the database writes it.
    pub created_at: String,
}

/// A milestone as the `milestones` row it is written as. Unset optional fields are written `null`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MilestoneWriteRow {
    /// The milestone's id.
    pub id: String,
    /// The milestone's title.
    pub title: String,
    /// The description, or `null`.
    pub description: Option<String>,
    /// Current status.
    pub status: MilestoneStatus,
    /// Target date (yyyy-mm-dd), or `null`.
    pub target_date: Option<String>,
    /// Structured dependencies.
    pub dependencies: Vec<MilestoneDependency>,
    /// Compute needs.
    pub compute: Vec<ComputeNeed>,
    /// When the milestone was created.
    pub created_at: String,
}

/// The milestone a row maps to (`milestoneToDomain`). Null lists become empty lists.
#[must_use]
pub fn to_milestone(row: &MilestoneRow) -> Milestone {
    Milestone {
        id: row.id.clone(),
        title: row.title.clone(),
        description: row.description.clone(),
        status: row.status,
        target_date: row.target_date.clone(),
        dependencies: row.dependencies.clone().unwrap_or_default(),
        compute: row.compute.clone().unwrap_or_default(),
        created_at: row.created_at.clone(),
    }
}

/// The row a milestone is written as (`milestoneToRow`).
#[must_use]
pub fn to_row(milestone: &Milestone) -> MilestoneWriteRow {
    MilestoneWriteRow {
        id: milestone.id.clone(),
        title: milestone.title.clone(),
        description: milestone.description.clone(),
        status: milestone.status,
        target_date: milestone.target_date.clone(),
        dependencies: milestone.dependencies.clone(),
        compute: milestone.compute.clone(),
        created_at: milestone.created_at.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(
        dependencies: Option<Vec<MilestoneDependency>>,
        compute: Option<Vec<ComputeNeed>>,
    ) -> MilestoneRow {
        MilestoneRow {
            id: "m1".into(),
            title: "Draft chapter 2".into(),
            description: None,
            status: MilestoneStatus::InProgress,
            target_date: None,
            dependencies,
            compute,
            created_at: "2026-11-05T00:00:00.000Z".into(),
        }
    }

    #[test]
    fn null_lists_become_empty() {
        let made = to_milestone(&row(None, None));
        assert!(made.dependencies.is_empty());
        assert!(made.compute.is_empty());
        assert_eq!(made.status, MilestoneStatus::InProgress);
    }

    #[test]
    fn unset_optionals_are_absent_in_json() {
        let json = serde_json::to_value(to_milestone(&row(None, None))).expect("serialises");
        assert!(json.get("description").is_none());
        assert!(json.get("targetDate").is_none());
        assert_eq!(json["createdAt"], "2026-11-05T00:00:00.000Z");
    }

    #[test]
    fn write_row_uses_null_for_unset_optionals() {
        let milestone = to_milestone(&row(None, None));
        let json = serde_json::to_value(to_row(&milestone)).expect("serialises");
        assert!(json["description"].is_null());
        assert!(json["target_date"].is_null());
        assert_eq!(json["created_at"], "2026-11-05T00:00:00.000Z");
        assert_eq!(json["status"], "in_progress");
    }
}
