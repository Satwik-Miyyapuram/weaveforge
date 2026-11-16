//! Plan screen ordering and summary text (pure). A port of `byDue` and `planEyebrow`
//! in `apps/web/src/features/plan/ui/plan-screen.tsx`.

use std::cmp::Ordering;

use crate::plan::milestone::Milestone;

/// Dated milestones soonest first, undated ones after. Stable: equal dates keep their order.
#[must_use]
pub fn sort_by_due(milestones: &[Milestone]) -> Vec<Milestone> {
    let mut out = milestones.to_vec();
    out.sort_by(|a, b| match (dated(a), dated(b)) {
        (Some(x), Some(y)) => x.cmp(y),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    });
    out
}

/// The target date when it is a real date: JS truthiness, so an empty string counts as none.
fn dated(milestone: &Milestone) -> Option<&str> {
    milestone
        .target_date
        .as_deref()
        .filter(|date| !date.is_empty())
}

/// "3 milestones · 1 done" above the title; `None` when there are no milestones.
#[must_use]
pub fn plan_eyebrow(total: u32, done: u32) -> Option<String> {
    if total == 0 {
        return None;
    }
    let noun = if total == 1 {
        "milestone"
    } else {
        "milestones"
    };
    Some(format!("{total} {noun} \u{b7} {done} done"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lab_snapshot::MilestoneStatus;

    fn milestone(id: &str, target: Option<&str>) -> Milestone {
        Milestone {
            id: id.to_owned(),
            title: id.to_owned(),
            description: None,
            status: MilestoneStatus::Planned,
            target_date: target.map(str::to_owned),
            dependencies: Vec::new(),
            compute: Vec::new(),
            created_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    fn ids(items: &[Milestone]) -> Vec<&str> {
        items.iter().map(|m| m.id.as_str()).collect()
    }

    #[test]
    fn dated_milestones_come_soonest_first_then_undated() {
        let items = vec![
            milestone("none", None),
            milestone("late", Some("2026-09-01")),
            milestone("empty", Some("")),
            milestone("early", Some("2026-03-01")),
        ];
        assert_eq!(
            ids(&sort_by_due(&items)),
            vec!["early", "late", "none", "empty"]
        );
    }

    #[test]
    fn equal_dates_keep_their_order() {
        let items = vec![
            milestone("b", Some("2026-05-01")),
            milestone("a", Some("2026-05-01")),
        ];
        assert_eq!(ids(&sort_by_due(&items)), vec!["b", "a"]);
    }

    #[test]
    fn eyebrow_counts_milestones_and_done() {
        assert_eq!(plan_eyebrow(0, 0), None);
        assert_eq!(
            plan_eyebrow(1, 0).as_deref(),
            Some("1 milestone \u{b7} 0 done")
        );
        assert_eq!(
            plan_eyebrow(3, 1).as_deref(),
            Some("3 milestones \u{b7} 1 done")
        );
    }
}
