//! Words written against targets for report sections. Port of
//! `apps/web/src/features/report/lib/section-progress.ts`. Pure.

use super::report_section::ReportSectionTreeNode;

/// A section's (or outline's) word count against its target.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SectionProgress {
    /// Words written, the section's own text plus every subsection's.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub words: f64,
    /// Words aimed for, or `None` when there is no target to measure against.
    pub target: Option<f64>,
    /// 0 to 100, or `None` with no target to measure against.
    pub pct: Option<f64>,
}

/// JS truthiness for a number: neither zero nor NaN.
fn truthy(n: f64) -> bool {
    n != 0.0 && !n.is_nan()
}

/// Percent of `target` reached by `words`, capped at 100; `None` with no usable target.
fn percent(words: f64, target: Option<f64>) -> Option<f64> {
    match target {
        Some(t) if truthy(t) => Some((words / t * 100.0).round().min(100.0)),
        _ => None,
    }
}

/// Words written under a section, its own text and every subsection's, against
/// its target. A chapter's target covers its subsections; one with no target of
/// its own aims for theirs added up.
#[must_use]
pub fn section_progress(node: &ReportSectionTreeNode) -> SectionProgress {
    let mut words = node.section.word_count;
    let mut child_target = 0.0;
    for child in &node.children {
        let p = section_progress(child);
        words += p.words;
        child_target += p.target.unwrap_or(0.0);
    }
    let target = match node.section.target_words {
        Some(own) => Some(own),
        None if truthy(child_target) => Some(child_target),
        None => None,
    };
    SectionProgress {
        words,
        target,
        pct: percent(words, target),
    }
}

/// The whole outline: its top-level sections added up.
#[must_use]
pub fn outline_progress(roots: &[ReportSectionTreeNode]) -> SectionProgress {
    let mut words = 0.0;
    let mut target_sum = 0.0;
    for root in roots {
        let p = section_progress(root);
        words += p.words;
        target_sum += p.target.unwrap_or(0.0);
    }
    let target = truthy(target_sum).then_some(target_sum);
    SectionProgress {
        words,
        target,
        pct: percent(words, target),
    }
}

#[cfg(test)]
mod tests {
    use super::super::report_section::{ReportSection, ReportStatus};
    use super::*;

    fn node(
        word_count: f64,
        target_words: Option<f64>,
        children: Vec<ReportSectionTreeNode>,
    ) -> ReportSectionTreeNode {
        ReportSectionTreeNode {
            section: ReportSection {
                id: "s".to_owned(),
                title: "t".to_owned(),
                section_no: None,
                parent_id: None,
                status: ReportStatus::NotStarted,
                word_count,
                target_words,
                deadline: None,
                draft_url: None,
                notes: None,
                sort_order: 0.0,
                created_at: "2026-01-01T00:00:00Z".to_owned(),
                updated_at: None,
            },
            children,
        }
    }

    fn progress(words: f64, target: Option<f64>, pct: Option<f64>) -> SectionProgress {
        SectionProgress { words, target, pct }
    }

    #[test]
    fn a_leaf_measures_its_own_words() {
        assert_eq!(
            section_progress(&node(400.0, Some(800.0), vec![])),
            progress(400.0, Some(800.0), Some(50.0))
        );
        assert_eq!(
            section_progress(&node(120.0, None, vec![])),
            progress(120.0, None, None)
        );
    }

    #[test]
    fn a_chapter_counts_its_subsections_words_against_its_own_target() {
        let intro = node(
            10.0,
            Some(2500.0),
            vec![
                node(780.0, Some(900.0), vec![]),
                node(400.0, Some(800.0), vec![]),
                node(0.0, Some(300.0), vec![]),
            ],
        );
        assert_eq!(
            section_progress(&intro),
            progress(1190.0, Some(2500.0), Some(48.0))
        );
    }

    #[test]
    fn a_chapter_with_no_target_aims_for_its_subsections_total_capped_at_100() {
        let ch = node(
            0.0,
            None,
            vec![
                node(900.0, Some(900.0), vec![]),
                node(300.0, Some(200.0), vec![]),
            ],
        );
        assert_eq!(
            section_progress(&ch),
            progress(1200.0, Some(1100.0), Some(100.0))
        );
    }

    #[test]
    fn the_outline_adds_up_top_level_sections_only() {
        let roots = [
            node(10.0, Some(2500.0), vec![node(780.0, Some(900.0), vec![])]),
            node(0.0, Some(1000.0), vec![]),
        ];
        assert_eq!(
            outline_progress(&roots),
            progress(790.0, Some(3500.0), Some(23.0))
        );
    }

    #[test]
    fn a_zero_target_is_reported_but_gives_no_percent() {
        assert_eq!(
            section_progress(&node(5.0, Some(0.0), vec![])),
            progress(5.0, Some(0.0), None)
        );
    }
}
