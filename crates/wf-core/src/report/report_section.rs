//! Report (thesis) sections: creating one and building the outline tree. Port
//! of `packages/core/src/features/report/domain/report-section.ts`. Pure.

use crate::js_collate::locale_compare;
use crate::reader_analysis::lines::js_trim;
use crate::tree::{TreeNode, build_tree};

/// A section's writing status, in workflow order.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ReportStatus {
    /// Not begun.
    #[default]
    NotStarted,
    /// Being written.
    Drafting,
    /// Waiting for review.
    Review,
    /// Finished.
    Done,
}

/// Every `ReportStatus`, in workflow order.
pub const REPORT_STATUSES: &[ReportStatus] = &[
    ReportStatus::NotStarted,
    ReportStatus::Drafting,
    ReportStatus::Review,
    ReportStatus::Done,
];

/// One node of the thesis outline.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ReportSection {
    /// Section id.
    pub id: String,
    /// Title, trimmed.
    pub title: String,
    /// Outline number, e.g. "3.2".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section_no: Option<String>,
    /// Parent section id; absent = top level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// Writing status.
    pub status: ReportStatus,
    /// Words written.
    pub word_count: f64,
    /// Words aimed for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_words: Option<f64>,
    /// ISO date (yyyy-mm-dd).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    /// Overleaf / Google Doc / repo path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft_url: Option<String>,
    /// Free notes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Order among siblings.
    pub sort_order: f64,
    /// ISO creation time.
    pub created_at: String,
    /// When the section last changed; absent until first read back.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// What a caller supplies to create a section.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct NewReportSectionInput {
    /// Title; required after trimming.
    #[serde(default)]
    pub title: Option<String>,
    /// Outline number.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section_no: Option<String>,
    /// Parent section id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// Status; defaults to not started.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<ReportStatus>,
    /// Words written; defaults to 0.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub word_count: Option<f64>,
    /// Words aimed for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_words: Option<f64>,
    /// ISO date.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    /// Draft link.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft_url: Option<String>,
    /// Free notes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Order among siblings; defaults to 0.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<f64>,
}

/// A section with its descendants resolved.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ReportSectionTreeNode {
    /// The section.
    pub section: ReportSection,
    /// Child sections, sorted.
    pub children: Vec<ReportSectionTreeNode>,
}

/// Check caller input before any id or time is drawn, as TS throws first.
///
/// # Errors
///
/// The validation message when the title is blank or a count is negative.
pub fn validate_report_section_input(input: &NewReportSectionInput) -> Result<(), String> {
    if input
        .title
        .as_deref()
        .map(js_trim)
        .unwrap_or_default()
        .is_empty()
    {
        return Err("Section title is required.".to_owned());
    }
    if input.word_count.is_some_and(|n| n < 0.0) {
        return Err("Word count cannot be negative.".to_owned());
    }
    if input.target_words.is_some_and(|n| n < 0.0) {
        return Err("Target words cannot be negative.".to_owned());
    }
    Ok(())
}

/// Create a section from caller input, with the id and time supplied.
///
/// # Errors
///
/// The validation message when the title is blank or a count is negative.
pub fn create_report_section(
    input: &NewReportSectionInput,
    id: &str,
    now_iso: &str,
) -> Result<ReportSection, String> {
    validate_report_section_input(input)?;
    let title = input.title.as_deref().map(js_trim).unwrap_or_default();
    let section_no = input
        .section_no
        .as_deref()
        .map(js_trim)
        .filter(|no| !no.is_empty())
        .map(str::to_owned);
    Ok(ReportSection {
        id: id.to_owned(),
        title: title.to_owned(),
        section_no,
        parent_id: input.parent_id.clone(),
        status: input.status.unwrap_or_default(),
        word_count: input.word_count.unwrap_or(0.0),
        target_words: input.target_words,
        deadline: input.deadline.clone(),
        draft_url: input.draft_url.clone(),
        notes: input.notes.clone(),
        sort_order: input.sort_order.unwrap_or(0.0),
        created_at: now_iso.to_owned(),
        updated_at: None,
    })
}

/// JS `a - b || 0`-style number order: NaN compares equal, as a NaN difference is falsy.
fn number_order(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

/// Build the outline tree from a flat list. Siblings are ordered by
/// `sortOrder`, then `sectionNo`, then `title`.
#[must_use]
pub fn build_section_tree(sections: Vec<ReportSection>) -> Vec<ReportSectionTreeNode> {
    let forest = build_tree(
        sections,
        |s| s.id.as_str(),
        |s| s.parent_id.as_deref(),
        |a, b| {
            number_order(a.sort_order, b.sort_order)
                .then_with(|| {
                    locale_compare(
                        a.section_no.as_deref().unwrap_or(""),
                        b.section_no.as_deref().unwrap_or(""),
                    )
                })
                .then_with(|| locale_compare(&a.title, &b.title))
        },
    );
    forest.into_iter().map(to_node).collect()
}

fn to_node(node: TreeNode<ReportSection>) -> ReportSectionTreeNode {
    ReportSectionTreeNode {
        section: node.item,
        children: node.children.into_iter().map(to_node).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(title: &str) -> NewReportSectionInput {
        NewReportSectionInput {
            title: Some(title.to_owned()),
            ..NewReportSectionInput::default()
        }
    }

    fn section(
        id: &str,
        parent: Option<&str>,
        order: f64,
        no: Option<&str>,
        title: &str,
    ) -> ReportSection {
        let mut s = create_report_section(&input(title), id, "t").unwrap_or_else(|e| panic!("{e}"));
        s.parent_id = parent.map(str::to_owned);
        s.sort_order = order;
        s.section_no = no.map(str::to_owned);
        s
    }

    #[test]
    fn create_trims_and_defaults() {
        let mut i = input("  Intro  ");
        i.section_no = Some("   ".to_owned());
        let s = create_report_section(&i, "id1", "2026-01-01T00:00:00.000Z");
        let s = s.unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(s.title, "Intro");
        assert_eq!(s.section_no, None);
        assert_eq!(s.status, ReportStatus::NotStarted);
        assert!(s.word_count == 0.0 && s.sort_order == 0.0);
        assert_eq!(s.created_at, "2026-01-01T00:00:00.000Z");
    }

    #[test]
    fn create_rejects_blank_title_and_negative_counts() {
        assert_eq!(
            create_report_section(&input(" \n"), "i", "t"),
            Err("Section title is required.".to_owned())
        );
        assert!(create_report_section(&NewReportSectionInput::default(), "i", "t").is_err());
        let mut i = input("x");
        i.word_count = Some(-1.0);
        assert_eq!(
            create_report_section(&i, "i", "t"),
            Err("Word count cannot be negative.".to_owned())
        );
        let mut i = input("x");
        i.target_words = Some(-0.5);
        assert_eq!(
            create_report_section(&i, "i", "t"),
            Err("Target words cannot be negative.".to_owned())
        );
    }

    #[test]
    fn tree_orders_by_sort_order_then_number_then_title() {
        let tree = build_section_tree(vec![
            section("c", None, 1.0, None, "Zeta"),
            section("b", None, 0.0, Some("2"), "B"),
            section("a", None, 0.0, Some("1"), "A"),
            section("a2", Some("a"), 0.0, None, "beta"),
            section("a1", Some("a"), 0.0, None, "Alpha"),
        ]);
        let top: Vec<&str> = tree.iter().map(|n| n.section.id.as_str()).collect();
        assert_eq!(top, ["a", "b", "c"]);
        let kids: Vec<&str> = tree[0]
            .children
            .iter()
            .map(|n| n.section.id.as_str())
            .collect();
        assert_eq!(kids, ["a1", "a2"]);
    }

    #[test]
    fn serializes_without_absent_fields() {
        let json = serde_json::to_value(section("a", None, 0.0, None, "A")).unwrap_or_default();
        assert!(json.get("sectionNo").is_none() && json.get("updatedAt").is_none());
        assert_eq!(json["status"], "not_started");
    }
}
