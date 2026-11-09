//! Search palette hit order and the Space-to-preview key (wf-core `palette_sort`). Ported from
//! `apps/web/src/lib/palette-sort.ts`.
//!
//! [`sort_hit_order`] returns indices, not rows, so the caller keeps its own row objects (with
//! their callbacks) and maps the indices back.

use std::cmp::Ordering;

use serde::Deserialize;

use crate::js_collate::locale_compare;
use crate::palette_groups::PaletteKey;
use crate::sync::instant::parse_instant;

/// How the search palette orders its hits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum HitSort {
    /// The ranked order from the search.
    Relevance,
    /// Latest `updated_at` first.
    Newest,
    /// Case-insensitive, with digit runs in numeric order.
    Title,
}

/// One hit, as much of it as the order needs.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct HitKey {
    /// The title the palette shows.
    pub title: String,
    /// The last edit, as an ISO 8601 date or date-time.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub updated_at: Option<String>,
}

/// The indices of `rows` in the chosen order. Ties keep their ranked order (the sort is stable),
/// so "Newest" still puts the better match first among same-day edits.
#[must_use]
pub fn sort_hit_order(rows: &[HitKey], order: HitSort) -> Vec<usize> {
    let mut indices: Vec<usize> = (0..rows.len()).collect();
    match order {
        HitSort::Relevance => {}
        HitSort::Newest => {
            indices.sort_by(|&a, &b| {
                time(rows[b].updated_at.as_deref()).cmp(&time(rows[a].updated_at.as_deref()))
            });
        }
        HitSort::Title => {
            indices.sort_by(|&a, &b| title_compare(&rows[a].title, &rows[b].title));
        }
    }
    indices
}

/// Missing or unreadable dates are `None`, which sorts last when descending.
fn time(updated_at: Option<&str>) -> Option<i64> {
    updated_at.and_then(parse_instant)
}

/// Digit runs compare by value; other runs compare as locale text, ignoring case.
fn title_compare(a: &str, b: &str) -> Ordering {
    let (a, b) = (runs(a), runs(b));
    for ((text_a, digits_a), (text_b, digits_b)) in a.iter().zip(&b) {
        let ord = if *digits_a && *digits_b {
            compare_numbers(text_a, text_b)
        } else {
            locale_compare(&text_a.to_lowercase(), &text_b.to_lowercase())
        };
        if ord != Ordering::Equal {
            return ord;
        }
    }
    a.len().cmp(&b.len())
}

/// Split into alternating runs: `(text, is_digits)`.
fn runs(s: &str) -> Vec<(String, bool)> {
    let mut out: Vec<(String, bool)> = Vec::new();
    for ch in s.chars() {
        let digit = ch.is_ascii_digit();
        match out.last_mut() {
            Some((text, is_digits)) if *is_digits == digit => text.push(ch),
            _ => out.push((ch.to_string(), digit)),
        }
    }
    out
}

/// Compare two digit runs by value, without parsing, so long runs cannot overflow.
fn compare_numbers(a: &str, b: &str) -> Ordering {
    let (a, b) = (a.trim_start_matches('0'), b.trim_start_matches('0'));
    a.len().cmp(&b.len()).then_with(|| a.cmp(b))
}

/// Space opens the preview, as in Finder. In the search box Space types a space, so there it
/// takes Shift+Space. Other modifiers belong to the system or the input method.
#[must_use]
pub fn is_preview_key(event: &PaletteKey, in_text_box: bool) -> bool {
    if event.key != " " || event.ctrl_key || event.meta_key || event.alt_key {
        return false;
    }
    event.shift_key || !in_text_box
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(title: &str, updated: Option<&str>) -> HitKey {
        HitKey {
            title: title.to_owned(),
            updated_at: updated.map(str::to_owned),
        }
    }

    fn titles(rows: &[HitKey], order: &[usize]) -> Vec<String> {
        order.iter().map(|&i| rows[i].title.clone()).collect()
    }

    fn rows() -> Vec<HitKey> {
        vec![
            hit("beta", Some("2026-01-02T00:00:00Z")),
            hit("Alpha", Some("2026-03-01T00:00:00Z")),
            hit("gamma", None),
            hit("item 10", Some("not a date")),
            hit("item 9", Some("2026-02-01T00:00:00Z")),
        ]
    }

    #[test]
    fn relevance_keeps_the_ranked_order() {
        let rows = rows();
        let order = sort_hit_order(&rows, HitSort::Relevance);
        assert_eq!(order, vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn newest_puts_the_latest_first_and_undated_last_in_ranked_order() {
        let rows = rows();
        let order = sort_hit_order(&rows, HitSort::Newest);
        assert_eq!(
            titles(&rows, &order),
            ["Alpha", "item 9", "beta", "gamma", "item 10"]
        );
    }

    #[test]
    fn title_is_case_insensitive_with_numbers_in_natural_order() {
        let rows = rows();
        let order = sort_hit_order(&rows, HitSort::Title);
        assert_eq!(
            titles(&rows, &order),
            ["Alpha", "beta", "gamma", "item 9", "item 10"]
        );
    }

    #[test]
    fn equal_keys_keep_their_ranked_order() {
        let ties = vec![hit("same", None), hit("Same", None), hit("same", None)];
        assert_eq!(sort_hit_order(&ties, HitSort::Title), vec![0, 1, 2]);
        assert_eq!(sort_hit_order(&ties, HitSort::Newest), vec![0, 1, 2]);
    }

    #[test]
    fn empty_input_sorts_to_empty() {
        for order in [HitSort::Relevance, HitSort::Newest, HitSort::Title] {
            assert!(sort_hit_order(&[], order).is_empty());
        }
    }

    #[test]
    fn digit_runs_compare_by_value_not_length_of_zeros() {
        assert_eq!(compare_numbers("007", "7"), Ordering::Equal);
        assert_eq!(compare_numbers("9", "10"), Ordering::Less);
        assert_eq!(compare_numbers("0", "00"), Ordering::Equal);
    }

    fn key(key: &str, shift: bool, ctrl: bool, meta: bool, alt: bool) -> PaletteKey {
        PaletteKey {
            key: key.to_owned(),
            shift_key: shift,
            ctrl_key: ctrl,
            meta_key: meta,
            alt_key: alt,
        }
    }

    #[test]
    fn space_previews_only_outside_the_text_box_and_shift_space_anywhere() {
        assert!(is_preview_key(&key(" ", false, false, false, false), false));
        assert!(!is_preview_key(&key(" ", false, false, false, false), true));
        assert!(is_preview_key(&key(" ", true, false, false, false), true));
    }

    #[test]
    fn other_modifiers_and_keys_are_not_preview() {
        assert!(!is_preview_key(&key(" ", false, true, false, false), false));
        assert!(!is_preview_key(&key(" ", false, false, true, false), false));
        assert!(!is_preview_key(&key(" ", false, false, false, true), false));
        assert!(!is_preview_key(&key("a", false, false, false, false), false));
    }
}
