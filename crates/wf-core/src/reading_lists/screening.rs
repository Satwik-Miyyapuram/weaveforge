//! Screening decisions, agreement between reviewers, and PRISMA counts. Port of
//! `packages/core/src/features/reading-lists/domain/screening.ts`.
//!
//! A decision belongs to a reviewer and a stage, so two reviewers disagreeing is a
//! normal state. Every count is derived from the decisions each time it is asked for.
//! Pure: no I/O and no clock; the caller supplies both.

use std::cmp::Ordering;

use crate::js_collate::locale_compare;
use crate::reader_analysis::lines::js_trim;
use crate::report::prisma_figure::{ExclusionReasonCount, PrismaCounts};

/// The two passes of a screen. Full text is only reached by surviving the first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ScreeningStage {
    /// Title and abstract.
    TitleAbstract,
    /// Full text.
    FullText,
}

/// What one reviewer decided. `unsure` is an answer, not an absent one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ScreeningState {
    /// Kept.
    Included,
    /// Dropped.
    Excluded,
    /// Could not tell; goes on to the full text.
    Unsure,
}

/// Every screening state, in the TS order (`SCREENING_STATES`).
pub const SCREENING_STATES: [ScreeningState; 3] = [
    ScreeningState::Included,
    ScreeningState::Excluded,
    ScreeningState::Unsure,
];

/// One reviewer's decision on one item at one stage.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ScreeningDecision {
    /// Row id.
    pub id: String,
    /// The `reading_list_items` row: this paper, in this review.
    pub item_id: String,
    /// Who decided.
    pub reviewer_id: String,
    /// Which pass.
    pub stage: ScreeningStage,
    /// What they decided.
    pub state: ScreeningState,
    /// Why. Expected for an exclusion at full text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// ISO time of the decision.
    pub decided_at: String,
}

/// The decision a reviewer is about to record. Stage and state stay strings, because
/// [`decision_error`] is what rejects a state that is not one.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ScreeningDecisionDraft {
    /// The item being screened.
    pub item_id: String,
    /// Who is deciding.
    pub reviewer_id: String,
    /// Which pass, as sent.
    pub stage: String,
    /// The decision, as sent.
    pub state: String,
}

/// Where one item stands at one stage.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ItemVerdict {
    /// The item.
    pub item_id: String,
    /// The stage.
    pub stage: ScreeningStage,
    /// What the reviewers agree on, or null while they do not.
    pub state: Option<ScreeningState>,
    /// True when reviewers recorded different states.
    pub conflict: bool,
    /// How many reviewers have answered at all.
    pub answered: u32,
}

/// How much two reviewers agree, and how much of that is not luck.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Agreement {
    /// The two reviewers compared, in the order given.
    pub reviewers: (String, String),
    /// Items both of them screened at this stage.
    pub compared: u32,
    /// Items they answered identically.
    pub agreed: u32,
    /// `agreed / compared`, or null when they screened nothing in common.
    pub proportion: Option<f64>,
    /// Cohen's kappa, or null when there is nothing to compare or chance agreement is total.
    pub kappa: Option<f64>,
}

/// A list item as the PRISMA counts see it.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ScreeningItem {
    /// The `reading_list_items` row id.
    pub id: String,
    /// Marked as a duplicate of another record in the same list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duplicate_of_item_id: Option<String>,
}

/// JS `<` on strings: UTF-16 code unit order.
fn js_str_cmp(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// JS truthiness of an optional string.
fn truthy(value: Option<&String>) -> bool {
    value.is_some_and(|s| !s.is_empty())
}

/// TS `checkDecision`: the error message for `next`, or `None` when it may be recorded.
///
/// A full-text decision needs the same reviewer's title-and-abstract decision first,
/// and must not follow their own exclusion.
#[must_use]
pub fn decision_error(
    next: &ScreeningDecisionDraft,
    existing: &[ScreeningDecision],
) -> Option<String> {
    if !matches!(next.state.as_str(), "included" | "excluded" | "unsure") {
        return Some(format!("'{}' is not a screening decision.", next.state));
    }
    if next.stage != "full_text" {
        return None;
    }
    let earlier = existing.iter().find(|decision| {
        decision.item_id == next.item_id
            && decision.reviewer_id == next.reviewer_id
            && decision.stage == ScreeningStage::TitleAbstract
    });
    match earlier {
        None => Some("Screen the title and abstract before the full text.".to_owned()),
        Some(decision) if decision.state == ScreeningState::Excluded => Some(
            "You excluded this on the abstract. Revise that decision rather than screening the full text."
                .to_owned(),
        ),
        Some(_) => None,
    }
}

/// TS `latestByReviewer`: the latest decision per reviewer for one item, in the order
/// reviewers first appear (the TS `Map` order). Ties go to the later decision.
#[must_use]
pub fn latest_by_reviewer<'a>(
    decisions: &'a [ScreeningDecision],
    item_id: &str,
    stage: ScreeningStage,
) -> Vec<&'a ScreeningDecision> {
    let mut latest: Vec<&ScreeningDecision> = Vec::new();
    for decision in decisions {
        if decision.item_id != item_id || decision.stage != stage {
            continue;
        }
        match latest
            .iter_mut()
            .find(|held| held.reviewer_id == decision.reviewer_id)
        {
            Some(held) => {
                if js_str_cmp(&held.decided_at, &decision.decided_at) != Ordering::Greater {
                    *held = decision;
                }
            }
            None => latest.push(decision),
        }
    }
    latest
}

/// TS `verdictFor`: one reviewer's answer stands alone; two who disagree is a conflict
/// with no state.
#[must_use]
pub fn verdict_for(
    decisions: &[ScreeningDecision],
    item_id: &str,
    stage: ScreeningStage,
) -> ItemVerdict {
    let latest = latest_by_reviewer(decisions, item_id, stage);
    let mut states: Vec<ScreeningState> = Vec::new();
    for decision in &latest {
        if !states.contains(&decision.state) {
            states.push(decision.state);
        }
    }
    ItemVerdict {
        item_id: item_id.to_owned(),
        stage,
        state: if states.len() == 1 {
            states.first().copied()
        } else {
            None
        },
        conflict: states.len() > 1,
        answered: u32::try_from(latest.len()).unwrap_or(u32::MAX),
    }
}

/// TS `verdictsFor`: both stages' verdicts for each item, in item order, then stage order.
#[must_use]
pub fn verdicts_for(items: &[ScreeningItem], decisions: &[ScreeningDecision]) -> Vec<ItemVerdict> {
    // One pass over the decisions: group them by item, then judge each item's group.
    let mut by_item: std::collections::HashMap<&str, Vec<ScreeningDecision>> =
        std::collections::HashMap::new();
    for decision in decisions {
        by_item
            .entry(decision.item_id.as_str())
            .or_default()
            .push(decision.clone());
    }
    let mut verdicts = Vec::with_capacity(items.len() * 2);
    for item in items {
        let group = by_item.get(item.id.as_str()).map_or(&[][..], Vec::as_slice);
        for stage in [ScreeningStage::TitleAbstract, ScreeningStage::FullText] {
            verdicts.push(verdict_for(group, &item.id, stage));
        }
    }
    verdicts
}

/// Distinct item ids in the order they first appear.
fn item_ids(decisions: &[ScreeningDecision]) -> Vec<&str> {
    let mut ids: Vec<&str> = Vec::new();
    for decision in decisions {
        if !ids.contains(&decision.item_id.as_str()) {
            ids.push(&decision.item_id);
        }
    }
    ids
}

fn count_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// TS `agreementBetween`: percent agreement and Cohen's kappa for two reviewers.
#[must_use]
pub fn agreement_between(
    decisions: &[ScreeningDecision],
    reviewers: (String, String),
    stage: ScreeningStage,
) -> Agreement {
    let mut pairs: Vec<(ScreeningState, ScreeningState)> = Vec::new();
    for item_id in item_ids(decisions) {
        let latest = latest_by_reviewer(decisions, item_id, stage);
        let state_of = |reviewer: &str| {
            latest
                .iter()
                .find(|d| d.reviewer_id == reviewer)
                .map(|d| d.state)
        };
        if let (Some(a), Some(b)) = (state_of(&reviewers.0), state_of(&reviewers.1)) {
            pairs.push((a, b));
        }
    }

    let compared = pairs.len();
    let agreed = pairs.iter().filter(|(a, b)| a == b).count();
    if compared == 0 {
        return Agreement {
            reviewers,
            compared: 0,
            agreed: 0,
            proportion: None,
            kappa: None,
        };
    }

    #[allow(clippy::cast_precision_loss)]
    let ratio = |n: usize| n as f64 / compared as f64;
    let observed = ratio(agreed);
    let mut expected = 0.0;
    for state in SCREENING_STATES {
        let a = ratio(pairs.iter().filter(|(a, _)| *a == state).count());
        let b = ratio(pairs.iter().filter(|(_, b)| *b == state).count());
        expected += a * b;
    }

    Agreement {
        reviewers,
        compared: count_u32(compared),
        agreed: count_u32(agreed),
        proportion: Some(observed),
        kappa: if expected >= 1.0 {
            None
        } else {
            Some((observed - expected) / (1.0 - expected))
        },
    }
}

/// TS `prismaCounts`: the PRISMA numbers, derived from the decisions every time.
#[must_use]
pub fn prisma_counts(items: &[ScreeningItem], decisions: &[ScreeningDecision]) -> PrismaCounts {
    let duplicates = items
        .iter()
        .filter(|item| truthy(item.duplicate_of_item_id.as_ref()))
        .count();
    let screened: Vec<&ScreeningItem> = items
        .iter()
        .filter(|item| !truthy(item.duplicate_of_item_id.as_ref()))
        .collect();

    let mut excluded_at_screening = 0usize;
    let mut eligible = 0usize;
    let mut excluded_at_full_text = 0usize;
    let mut included = 0usize;
    let mut undecided = 0usize;
    let mut conflicts = 0usize;

    for item in &screened {
        let abstract_verdict = verdict_for(decisions, &item.id, ScreeningStage::TitleAbstract);
        if abstract_verdict.conflict {
            conflicts += 1;
        }
        if abstract_verdict.answered == 0 {
            undecided += 1;
            continue;
        }
        if abstract_verdict.state == Some(ScreeningState::Excluded) {
            excluded_at_screening += 1;
            continue;
        }
        // `unsure` and an unresolved conflict both go on to the full text.
        eligible += 1;

        let full = verdict_for(decisions, &item.id, ScreeningStage::FullText);
        if full.conflict {
            conflicts += 1;
        }
        if full.answered == 0 {
            undecided += 1;
        } else if full.state == Some(ScreeningState::Included) {
            included += 1;
        } else if full.state == Some(ScreeningState::Excluded) {
            excluded_at_full_text += 1;
        }
    }

    #[allow(clippy::cast_precision_loss)]
    let f = |n: usize| n as f64;
    PrismaCounts {
        identified: f(items.len()),
        duplicates: f(duplicates),
        screened: f(screened.len()),
        excluded_at_screening: f(excluded_at_screening),
        eligible: f(eligible),
        excluded_at_full_text: f(excluded_at_full_text),
        included: f(included),
        undecided: f(undecided),
        conflicts: f(conflicts),
    }
}

/// TS `exclusionReasons`: why items were excluded at `stage`, most common first.
/// One reason per item: the first reviewer who gave a non-blank one, trimmed.
#[must_use]
pub fn exclusion_reasons(
    decisions: &[ScreeningDecision],
    stage: ScreeningStage,
) -> Vec<ExclusionReasonCount> {
    let mut counts: Vec<(String, usize)> = Vec::new();
    for item_id in item_ids(decisions) {
        if verdict_for(decisions, item_id, stage).state != Some(ScreeningState::Excluded) {
            continue;
        }
        let Some(reason) = latest_by_reviewer(decisions, item_id, stage)
            .into_iter()
            .filter_map(|decision| decision.reason.as_deref().map(js_trim))
            .find(|reason| !reason.is_empty())
        else {
            continue;
        };
        match counts.iter_mut().find(|(held, _)| held == reason) {
            Some((_, count)) => *count += 1,
            None => counts.push((reason.to_owned(), 1)),
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| locale_compare(&a.0, &b.0)));
    #[allow(clippy::cast_precision_loss)]
    counts
        .into_iter()
        .map(|(reason, count)| ExclusionReasonCount {
            reason,
            count: count as f64,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decision(
        item: &str,
        reviewer: &str,
        stage: ScreeningStage,
        state: ScreeningState,
        at: &str,
    ) -> ScreeningDecision {
        ScreeningDecision {
            id: format!("{item}-{reviewer}-{at}"),
            item_id: item.to_owned(),
            reviewer_id: reviewer.to_owned(),
            stage,
            state,
            reason: None,
            decided_at: at.to_owned(),
        }
    }

    fn draft(stage: &str, state: &str) -> ScreeningDecisionDraft {
        ScreeningDecisionDraft {
            item_id: "i".to_owned(),
            reviewer_id: "r".to_owned(),
            stage: stage.to_owned(),
            state: state.to_owned(),
        }
    }

    use ScreeningStage::{FullText, TitleAbstract};
    use ScreeningState::{Excluded, Included, Unsure};

    #[test]
    fn decision_error_follows_ts_rules() {
        assert_eq!(
            decision_error(&draft("full_text", "maybe"), &[]).unwrap(),
            "'maybe' is not a screening decision."
        );
        assert_eq!(
            decision_error(&draft("title_abstract", "included"), &[]),
            None
        );
        assert!(
            decision_error(&draft("full_text", "included"), &[])
                .unwrap()
                .starts_with("Screen the title")
        );
        let excluded = [decision("i", "r", TitleAbstract, Excluded, "1")];
        assert!(
            decision_error(&draft("full_text", "included"), &excluded)
                .unwrap()
                .starts_with("You excluded")
        );
        let unsure = [decision("i", "r", TitleAbstract, Unsure, "1")];
        assert_eq!(
            decision_error(&draft("full_text", "included"), &unsure),
            None
        );
    }

    #[test]
    fn latest_keeps_first_seen_order_and_later_ties() {
        let ds = [
            decision("i", "b", TitleAbstract, Included, "2"),
            decision("i", "a", TitleAbstract, Included, "1"),
            decision("i", "b", TitleAbstract, Excluded, "2"),
            decision("i", "b", TitleAbstract, Unsure, "1"),
        ];
        let latest = latest_by_reviewer(&ds, "i", TitleAbstract);
        assert_eq!(
            latest
                .iter()
                .map(|d| d.reviewer_id.as_str())
                .collect::<Vec<_>>(),
            ["b", "a"]
        );
        assert_eq!(latest[0].state, Excluded);
    }

    #[test]
    fn kappa_is_null_when_chance_agreement_is_total() {
        let ds = [
            decision("i", "a", TitleAbstract, Included, "1"),
            decision("i", "b", TitleAbstract, Included, "1"),
        ];
        let agreement = agreement_between(&ds, ("a".to_owned(), "b".to_owned()), TitleAbstract);
        assert_eq!(agreement.proportion, Some(1.0));
        assert_eq!(agreement.kappa, None);
    }

    #[test]
    fn prisma_counts_skip_empty_duplicate_marks() {
        let items = [
            ScreeningItem {
                id: "i".to_owned(),
                duplicate_of_item_id: Some(String::new()),
            },
            ScreeningItem {
                id: "j".to_owned(),
                duplicate_of_item_id: Some("i".to_owned()),
            },
        ];
        let ds = [
            decision("i", "a", TitleAbstract, Unsure, "1"),
            decision("i", "a", FullText, Included, "2"),
        ];
        let counts = prisma_counts(&items, &ds);
        assert_eq!(
            (
                counts.duplicates,
                counts.screened,
                counts.eligible,
                counts.included
            ),
            (1.0, 1.0, 1.0, 1.0)
        );
    }

    #[test]
    fn exclusion_reason_skips_a_blank_first_reason() {
        let mut first = decision("i1", "ann", FullText, Excluded, "t1");
        first.reason = Some("   ".to_owned());
        let mut second = decision("i1", "bob", FullText, Excluded, "t1");
        second.reason = Some(" a-b ".to_owned());
        let reasons = exclusion_reasons(&[first, second], FullText);
        assert_eq!(
            reasons,
            [ExclusionReasonCount {
                reason: "a-b".to_owned(),
                count: 1.0
            }]
        );
    }

    #[test]
    fn verdicts_for_gives_both_stages_per_item_in_order() {
        let ds = [
            decision("a", "ana", TitleAbstract, Included, "1"),
            decision("a", "bo", TitleAbstract, Excluded, "2"),
            decision("b", "ana", FullText, Unsure, "3"),
            decision("b", "ana", FullText, Included, "4"),
        ];
        let items: Vec<ScreeningItem> = ["a", "b", "z"]
            .iter()
            .map(|id| ScreeningItem {
                id: (*id).to_owned(),
                duplicate_of_item_id: None,
            })
            .collect();
        let mut expected = Vec::new();
        for id in ["a", "b", "z"] {
            for stage in [TitleAbstract, FullText] {
                expected.push(verdict_for(&ds, id, stage));
            }
        }
        let got = verdicts_for(&items, &ds);
        assert_eq!(got, expected);
        assert_eq!(got.len(), 6);
        assert!(got[0].conflict);
        assert_eq!(got[3].state, Some(Included));
        assert_eq!(got[4].answered, 0);
    }
}
