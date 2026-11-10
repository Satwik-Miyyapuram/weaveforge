//! Port of packages/core/src/features/plan/domain/milestone.ts. Pure: the caller supplies
//! the id and creation time.

use crate::lab_snapshot::MilestoneStatus;
use crate::reader_analysis::lines::js_trim;

/// What a dependency points at (TS `DependencyKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum DependencyKind {
    /// Another milestone, by id.
    Milestone,
    /// An experiment, by id.
    Experiment,
    /// A paper, by id.
    Paper,
    /// Free-form, carried as a label only.
    External,
}

/// Every dependency kind (TS `DEPENDENCY_KINDS`).
pub const DEPENDENCY_KINDS: &[DependencyKind] = &[
    DependencyKind::Milestone,
    DependencyKind::Experiment,
    DependencyKind::Paper,
    DependencyKind::External,
];

/// Every milestone status (TS `MILESTONE_STATUSES`).
pub const MILESTONE_STATUSES: &[MilestoneStatus] = &[
    MilestoneStatus::Planned,
    MilestoneStatus::InProgress,
    MilestoneStatus::Done,
    MilestoneStatus::Blocked,
];

/// A structured dependency (TS `MilestoneDependency`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MilestoneDependency {
    /// What the dependency points at.
    pub kind: DependencyKind,
    /// Referenced entity id (internal kinds).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional, type = String))]
    pub ref_id: Option<String>,
    /// Human label; required for `external`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional, type = String))]
    pub label: Option<String>,
}

/// A compute requirement (TS `ComputeNeed`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ComputeNeed {
    /// Resource name: GPU model, cluster partition, "CPU", "storage", ...
    pub resource: String,
    /// Number of units (GPUs, nodes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional, type = f64))]
    pub count: Option<f64>,
    /// Estimated hours of use.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional, type = f64))]
    pub hours: Option<f64>,
    /// Free-form note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional, type = String))]
    pub notes: Option<String>,
}

/// A forward-looking unit of the thesis plan (TS `Milestone`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Milestone {
    /// Unique id.
    pub id: String,
    /// Trimmed title.
    pub title: String,
    /// Optional description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional, type = String))]
    pub description: Option<String>,
    /// Current status.
    pub status: MilestoneStatus,
    /// Target date (yyyy-mm-dd).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional, type = String))]
    pub target_date: Option<String>,
    /// Structured dependencies.
    pub dependencies: Vec<MilestoneDependency>,
    /// Compute needs.
    pub compute: Vec<ComputeNeed>,
    /// Creation time, ISO 8601 UTC.
    pub created_at: String,
}

/// Input for a new milestone (TS `NewMilestoneInput`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct NewMilestoneInput {
    /// Title; trimmed and required.
    pub title: String,
    /// Optional description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional, type = String))]
    pub description: Option<String>,
    /// Status; defaults to `planned`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional, type = MilestoneStatus))]
    pub status: Option<MilestoneStatus>,
    /// Target date (yyyy-mm-dd).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional, type = String))]
    pub target_date: Option<String>,
    /// Structured dependencies.
    #[serde(default, deserialize_with = "crate::serde_util::null_default")]
    #[cfg_attr(feature = "specta", specta(optional, type = Vec<MilestoneDependency>))]
    pub dependencies: Vec<MilestoneDependency>,
    /// Compute needs.
    #[serde(default, deserialize_with = "crate::serde_util::null_default")]
    #[cfg_attr(feature = "specta", specta(optional, type = Vec<ComputeNeed>))]
    pub compute: Vec<ComputeNeed>,
}

/// True for a `yyyy-mm-dd` day that is on the calendar, e.g. not `2026-02-31` (TS `isIsoDay`).
#[must_use]
pub fn is_iso_day(value: &str) -> bool {
    let parts: Vec<&str> = value.split('-').collect();
    let (Some(year), Some(month), Some(day)) = (
        parts.first().and_then(|p| fixed_digits(p, 4)),
        parts.get(1).and_then(|p| fixed_digits(p, 2)),
        parts.get(2).and_then(|p| fixed_digits(p, 2)),
    ) else {
        return false;
    };
    parts.len() == 3 && (1..=12).contains(&month) && (1..=days_in_month(year, month)).contains(&day)
}

/// The `yyyy-mm-dd` day for calendar parts, with month and day zero-padded. `month` is 1-based
/// (TS `localIsoDay` passes `getMonth() + 1`). The parts are not checked; see [`is_iso_day`].
#[must_use]
pub fn iso_day_from_parts(year: i32, month: u32, day: u32) -> String {
    format!("{year}-{month:02}-{day:02}")
}

/// The number when `s` is exactly `len` ASCII digits.
fn fixed_digits(s: &str, len: usize) -> Option<u32> {
    if s.len() != len || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// Days in a proleptic Gregorian month, matching the JS `Date` calendar used by TS.
fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        2 if (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400) => {
            29
        }
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Validate a dependency list (TS `validateDependencies`).
///
/// # Errors
///
/// Returns the validation message for the first invalid entry.
pub fn validate_dependencies(deps: &[MilestoneDependency]) -> Result<(), String> {
    for d in deps {
        // The kind is an enum here, so TS's "Unknown dependency kind" cannot occur.
        if d.kind == DependencyKind::External {
            if js_trim(d.label.as_deref().unwrap_or("")).is_empty() {
                return Err("External dependencies need a label.".to_owned());
            }
        } else if js_trim(d.ref_id.as_deref().unwrap_or("")).is_empty() {
            return Err(format!("A {} dependency needs a refId.", kind_name(d.kind)));
        }
    }
    Ok(())
}

/// The TS string form of an internal dependency kind.
fn kind_name(kind: DependencyKind) -> &'static str {
    match kind {
        DependencyKind::Milestone => "milestone",
        DependencyKind::Experiment => "experiment",
        DependencyKind::Paper => "paper",
        DependencyKind::External => "external",
    }
}

/// Validate compute needs; the first invalid entry is the error (TS `validateCompute`).
///
/// # Errors
///
/// Returns the validation message for the first invalid entry.
pub fn validate_compute(compute: &[ComputeNeed]) -> Result<(), String> {
    for c in compute {
        if js_trim(&c.resource).is_empty() {
            return Err("Compute needs a resource name.".to_owned());
        }
        if c.count.is_some_and(|n| !n.is_finite() || n <= 0.0) {
            return Err("Compute count must be a positive number.".to_owned());
        }
        if c.hours.is_some_and(|h| !h.is_finite() || h < 0.0) {
            return Err("Compute hours cannot be negative.".to_owned());
        }
    }
    Ok(())
}

/// Validate a whole new-milestone input, in TS order: title, target date, dependencies, compute.
///
/// # Errors
///
/// Returns the first validation message.
pub fn validate_new_milestone(input: &NewMilestoneInput) -> Result<(), String> {
    if js_trim(&input.title).is_empty() {
        return Err("Milestone title is required.".to_owned());
    }
    // An empty target date is treated as absent, as in TS.
    if let Some(date) = input.target_date.as_deref().filter(|d| !d.is_empty())
        && !is_iso_day(date)
    {
        return Err("Target date must be yyyy-mm-dd.".to_owned());
    }
    validate_dependencies(&input.dependencies)?;
    validate_compute(&input.compute)
}

/// Build a milestone with the id and creation time supplied (TS `createMilestone`).
///
/// # Errors
///
/// Returns the first validation message; nothing is built for invalid input.
pub fn create_milestone(
    input: &NewMilestoneInput,
    id: &str,
    created_at: &str,
) -> Result<Milestone, String> {
    validate_new_milestone(input)?;
    Ok(Milestone {
        id: id.to_owned(),
        title: js_trim(&input.title).to_owned(),
        description: input.description.clone(),
        status: input.status.unwrap_or(MilestoneStatus::Planned),
        target_date: input.target_date.clone(),
        dependencies: input.dependencies.clone(),
        compute: input.compute.clone(),
        created_at: created_at.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dep(kind: DependencyKind, ref_id: Option<&str>, label: Option<&str>) -> MilestoneDependency {
        MilestoneDependency {
            kind,
            ref_id: ref_id.map(str::to_owned),
            label: label.map(str::to_owned),
        }
    }

    #[test]
    fn is_iso_day_checks_the_calendar() {
        assert!(is_iso_day("2026-02-28"));
        assert!(is_iso_day("2024-02-29"));
        assert!(!is_iso_day("2026-02-29"));
        assert!(!is_iso_day("2026-13-01"));
        assert!(!is_iso_day("2026-00-10"));
    }

    #[test]
    fn is_iso_day_rejects_bad_shape() {
        assert!(!is_iso_day("2026-1-01"));
        assert!(!is_iso_day("2026-01-01\n"));
        assert!(!is_iso_day("20260101"));
    }

    #[test]
    fn iso_day_from_parts_pads_month_and_day() {
        assert_eq!(iso_day_from_parts(2026, 1, 5), "2026-01-05");
        assert_eq!(iso_day_from_parts(2026, 12, 31), "2026-12-31");
        assert!(is_iso_day(&iso_day_from_parts(2024, 2, 29)));
    }

    #[test]
    fn external_dependency_needs_a_label() {
        let err = validate_dependencies(&[dep(DependencyKind::External, None, Some("  "))]);
        assert_eq!(err, Err("External dependencies need a label.".to_owned()));
        let err = validate_dependencies(&[dep(DependencyKind::Milestone, Some(" "), None)]);
        assert_eq!(err, Err("A milestone dependency needs a refId.".to_owned()));
    }

    #[test]
    fn compute_rejects_bad_numbers() {
        let need = |count: Option<f64>, hours: Option<f64>| ComputeNeed {
            resource: "A100".to_owned(),
            count,
            hours,
            notes: None,
        };
        assert!(validate_compute(&[need(Some(4.0), Some(0.0))]).is_ok());
        assert_eq!(
            validate_compute(&[need(Some(0.0), None)]),
            Err("Compute count must be a positive number.".to_owned())
        );
        assert_eq!(
            validate_compute(&[need(None, Some(-1.0))]),
            Err("Compute hours cannot be negative.".to_owned())
        );
    }

    #[test]
    fn create_milestone_trims_title_and_defaults_status() {
        let input = NewMilestoneInput {
            title: "  Draft chapter 2 ".to_owned(),
            description: None,
            status: None,
            target_date: Some(String::new()),
            dependencies: Vec::new(),
            compute: Vec::new(),
        };
        let made = create_milestone(&input, "m1", "2026-11-05T00:00:00.000Z").expect("valid");
        assert_eq!(made.title, "Draft chapter 2");
        assert_eq!(made.status, MilestoneStatus::Planned);
        assert_eq!(made.target_date.as_deref(), Some(""));
        assert_eq!(made.created_at, "2026-11-05T00:00:00.000Z");
    }

    #[test]
    fn create_milestone_rejects_empty_title() {
        let input = NewMilestoneInput {
            title: "   ".to_owned(),
            description: None,
            status: None,
            target_date: None,
            dependencies: Vec::new(),
            compute: Vec::new(),
        };
        assert_eq!(
            create_milestone(&input, "m1", "t"),
            Err("Milestone title is required.".to_owned())
        );
    }
}
