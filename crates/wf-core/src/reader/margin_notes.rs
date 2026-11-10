//! Stacking of margin comment cards down the page margin. A port of the stacking step of
//! `apps/web/src/features/reader/application/margin-notes.ts` (`layoutMarginNotes`).
//!
//! Which marks get a card, and where each mark starts on screen, stay in TS: they read
//! annotation fields and the picture rule.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

/// Vertical gap, in pixels, between two stacked cards.
pub const MARGIN_NOTE_GAP: f64 = 8.0;

/// Where one card sits: its index in the input, its stacked top, and where its mark starts.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MarginSlot {
    /// Index of the card's mark in the input slice.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub index: usize,
    /// Top of the card after stacking.
    pub top: f64,
    /// Top of the mark the card belongs to, before stacking.
    pub anchor_top: f64,
}

/// Stacks cards of `card_height` down the margin, one per entry of `anchor_tops`.
///
/// Cards come back in ascending `anchor_top` order (ties keep input order). Each card sits
/// level with its mark and is pushed down only as far as the card above it needs.
#[must_use]
pub fn stack_margin_notes(anchor_tops: &[f64], card_height: f64) -> Vec<MarginSlot> {
    let mut order: Vec<usize> = (0..anchor_tops.len()).collect();
    order.sort_by(|&a, &b| {
        anchor_tops[a]
            .partial_cmp(&anchor_tops[b])
            .unwrap_or(Ordering::Equal)
    });
    let mut floor = 0.0_f64;
    order
        .into_iter()
        .map(|index| {
            let anchor_top = anchor_tops[index];
            let top = anchor_top.max(floor);
            floor = top + card_height + MARGIN_NOTE_GAP;
            MarginSlot {
                index,
                top,
                anchor_top,
            }
        })
        .collect()
}
