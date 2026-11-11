//! Dashboard grid packing. Port of `apps/web/src/features/dashboard/application/parts.ts`.
//!
//! Pure geometry. Each card's size limits come in as data (the TS card registry), so this
//! module holds no card table of its own.

use std::cmp::Ordering;
use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// A width and height in grid cells.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Size {
    /// Width in columns.
    pub w: f64,
    /// Height in rows.
    pub h: f64,
}

/// One card type's size limits (the size fields of the TS `CardDef`).
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CardLimit {
    /// Card type id, as stored in the layout (`type`).
    #[serde(rename = "type")]
    pub card_type: String,
    /// Smallest size.
    pub min_size: Size,
    /// Largest size.
    pub max_size: Size,
    /// Size on a wide (12-column) grid.
    pub default_size: Size,
    /// Size on a narrow (4-column) grid.
    pub default_size_sm: Size,
}

/// One card placed on the grid. Keys the rules do not read pass through unchanged.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct LayoutItem {
    /// Card instance id.
    pub id: String,
    /// Card type id.
    #[serde(rename = "type")]
    pub card_type: String,
    /// Column of the top-left cell.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub x: f64,
    /// Row of the top-left cell.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub y: f64,
    /// Width in columns.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub w: f64,
    /// Height in rows.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub h: f64,
    /// Per-card settings.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional, type = std::collections::BTreeMap<String, specta_typescript::Unknown>))]
    pub config: Option<Map<String, Value>>,
    /// Any other keys, kept as they came in.
    /// Not in the TS type: callers pass their own card objects and get the
    /// unknown keys back untouched.
    #[serde(flatten)]
    #[cfg_attr(feature = "specta", specta(skip))]
    pub extra: Map<String, Value>,
}

/// A card type that is not in the limits table.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnknownCardType(pub String);

impl fmt::Display for UnknownCardType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Unknown card type: {}", self.0)
    }
}

impl std::error::Error for UnknownCardType {}

/// Min and max size of a card on a grid `cols` wide (TS `layoutFloors`).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Floors {
    /// Smallest width.
    pub min_w: f64,
    /// Smallest height.
    pub min_h: f64,
    /// Largest width on this grid.
    pub max_w: f64,
    /// Largest height.
    pub max_h: f64,
}

#[derive(Clone, Copy, Debug)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

fn rect(item: &LayoutItem) -> Rect {
    Rect {
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
    }
}

fn overlaps(a: Rect, b: Rect) -> bool {
    !(a.x + a.w <= b.x || a.x >= b.x + b.w || a.y + a.h <= b.y || a.y >= b.y + b.h)
}

/// Reading order: by row, then by column.
fn reading_order(a: &LayoutItem, b: &LayoutItem) -> Ordering {
    a.y.total_cmp(&b.y).then(a.x.total_cmp(&b.x))
}

fn limit_for<'a>(
    limits: &'a [CardLimit],
    card_type: &str,
) -> Result<&'a CardLimit, UnknownCardType> {
    limits
        .iter()
        .find(|l| l.card_type == card_type)
        .ok_or_else(|| UnknownCardType(card_type.to_owned()))
}

/// Min and max size of a card on a grid `cols` wide. Mobile (up to 4 columns) uses the
/// small default height and the card's own minimum width.
#[must_use]
pub fn floors(limit: &CardLimit, cols: f64) -> Floors {
    let mobile = cols <= 4.0;
    Floors {
        min_w: if mobile {
            limit.min_size.w
        } else {
            limit.min_size.w.max(limit.default_size.w)
        },
        min_h: if mobile {
            limit.min_size.h.max(limit.default_size_sm.h)
        } else {
            limit.min_size.h.max(limit.default_size.h)
        },
        max_w: limit.max_size.w.min(cols),
        max_h: limit.max_size.h,
    }
}

/// Clamp a card's size to its floors and its column to the grid.
///
/// # Errors
///
/// Fails when the card type has no entry in `limits`.
pub fn normalize_item(
    item: &LayoutItem,
    limits: &[CardLimit],
    cols: f64,
) -> Result<LayoutItem, UnknownCardType> {
    let f = floors(limit_for(limits, &item.card_type)?, cols);
    let w = f.min_w.max(f.max_w.min(item.w));
    let h = f.min_h.max(f.max_h.min(item.h));
    Ok(LayoutItem {
        w,
        h,
        x: 0.0_f64.max(item.x.min(cols - w)),
        ..item.clone()
    })
}

/// Pack items upward with no vertical gaps (react-grid-layout compact).
#[must_use]
pub fn compact_vertical(items: &[LayoutItem], cols: f64) -> Vec<LayoutItem> {
    let mut sorted = items.to_vec();
    sorted.sort_by(reading_order);
    let mut compacted: Vec<LayoutItem> = Vec::with_capacity(sorted.len());
    for item in sorted {
        let mut next = LayoutItem {
            x: 0.0_f64.max(item.x.min(cols - item.w)),
            ..item
        };
        let mut y = 0.0;
        loop {
            let probe = Rect {
                x: next.x,
                y,
                w: next.w,
                h: next.h,
            };
            match compacted.iter().find(|p| overlaps(probe, rect(p))) {
                None => {
                    next.y = y;
                    break;
                }
                Some(hit) => y = hit.y + hit.h,
            }
        }
        compacted.push(next);
    }
    compacted
}

/// Snap a mobile card width to half (2) or full (4) columns.
fn snap_sm_width(w: f64) -> f64 {
    let clamped = 2.0_f64.max(4.0_f64.min(w));
    if clamped >= 3.0 { 4.0 } else { 2.0 }
}

/// Pack mobile cards into a tight 4-column grid (row-major, no gaps). Widths snap to half or full.
///
/// # Errors
///
/// Fails when a card type has no entry in `limits`.
pub fn pack_sm(
    items: &[LayoutItem],
    limits: &[CardLimit],
) -> Result<Vec<LayoutItem>, UnknownCardType> {
    let mut adjusted = Vec::with_capacity(items.len());
    for it in items {
        let mut normalized = normalize_item(it, limits, 4.0)?;
        normalized.w = snap_sm_width(normalized.w);
        adjusted.push(normalized);
    }
    adjusted.sort_by(reading_order);

    let mut placed: Vec<LayoutItem> = Vec::with_capacity(adjusted.len());
    for item in adjusted {
        let xs: &[f64] = if item.w >= 4.0 { &[0.0] } else { &[0.0, 2.0] };
        let mut found: Option<(f64, f64)> = None;
        let mut y = 0.0;
        while found.is_none() && y < 200.0 {
            for &x in xs {
                if x + item.w > 4.0 {
                    continue;
                }
                let probe = Rect {
                    x,
                    y,
                    w: item.w,
                    h: item.h,
                };
                if !placed.iter().any(|p| overlaps(probe, rect(p))) {
                    found = Some((x, y));
                    break;
                }
            }
            y += 1.0;
        }
        let fallback_y = placed.iter().fold(0.0_f64, |m, p| m.max(p.y + p.h));
        let (x, y) = found.unwrap_or((0.0, fallback_y));
        placed.push(LayoutItem { x, y, ..item });
    }
    Ok(placed)
}

/// Close the holes in a desktop layout saved before the current default.
///
/// Each card, in reading order, takes the first place it fits. Then cards with free columns to
/// their right widen into them, and short cards beside a tall one grow into the hole below, each
/// up to its maximum size. Order is kept; cards only move, widen and lengthen.
///
/// # Errors
///
/// Fails when a card type has no entry in `limits`.
pub fn close_gaps(
    items: &[LayoutItem],
    limits: &[CardLimit],
    cols: f64,
) -> Result<Vec<LayoutItem>, UnknownCardType> {
    let mut sorted = Vec::with_capacity(items.len());
    for it in items {
        sorted.push(normalize_item(it, limits, cols)?);
    }
    sorted.sort_by(reading_order);

    let mut placed = place_in_reading_order(sorted, cols);

    // Widen right to left, so the rightmost card of a row takes the free columns.
    let mut by_right: Vec<usize> = (0..placed.len()).collect();
    by_right.sort_by(|&a, &b| placed[b].x.total_cmp(&placed[a].x));
    for i in by_right {
        let max_w = floors(limit_for(limits, &placed[i].card_type)?, cols).max_w;
        loop {
            let it = &placed[i];
            if !(it.x + it.w < cols && it.w < max_w) {
                break;
            }
            let probe = Rect {
                x: it.x + it.w,
                y: it.y,
                w: 1.0,
                h: it.h,
            };
            if !fits_except(probe, &placed, i) {
                break;
            }
            placed[i].w += 1.0;
        }
    }

    // A short card beside a tall one leaves a hole under it; it grows into the hole when
    // another card spans that row.
    for i in 0..placed.len() {
        let max_h = floors(limit_for(limits, &placed[i].card_type)?, cols).max_h;
        loop {
            let it = &placed[i];
            let below = it.y + it.h;
            let spans_below = placed
                .iter()
                .enumerate()
                .any(|(j, p)| j != i && p.y <= below && p.y + p.h > below);
            if !(it.h < max_h && spans_below) {
                break;
            }
            let probe = Rect {
                x: it.x,
                y: below,
                w: it.w,
                h: 1.0,
            };
            if !fits_except(probe, &placed, i) {
                break;
            }
            placed[i].h += 1.0;
        }
    }

    placed.sort_by(reading_order);
    Ok(placed)
}

/// Give each card, in reading order, the first place it fits scanning row by row. A card that
/// fits nowhere within 400 rows goes below everything placed so far.
fn place_in_reading_order(sorted: Vec<LayoutItem>, cols: f64) -> Vec<LayoutItem> {
    let mut placed: Vec<LayoutItem> = Vec::with_capacity(sorted.len());
    for it in sorted {
        let mut spot: Option<(f64, f64)> = None;
        let mut y = 0.0;
        while spot.is_none() && y < 400.0 {
            let mut x = 0.0;
            while x + it.w <= cols {
                let probe = Rect {
                    x,
                    y,
                    w: it.w,
                    h: it.h,
                };
                if !placed.iter().any(|p| overlaps(probe, rect(p))) {
                    spot = Some((x, y));
                    break;
                }
                x += 1.0;
            }
            y += 1.0;
        }
        let fallback_y = placed.iter().fold(0.0_f64, |m, p| m.max(p.y + p.h));
        let (x, y) = spot.unwrap_or((0.0, fallback_y));
        placed.push(LayoutItem { x, y, ..it });
    }
    placed
}

/// True when `probe` overlaps no card other than the one at index `skip`.
fn fits_except(probe: Rect, placed: &[LayoutItem], skip: usize) -> bool {
    placed
        .iter()
        .enumerate()
        .all(|(j, p)| j == skip || !overlaps(probe, rect(p)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stat_limit(card_type: &str) -> CardLimit {
        // The STAT_TILE constant in card-registry.ts.
        CardLimit {
            card_type: card_type.to_owned(),
            min_size: Size { w: 2.0, h: 2.0 },
            max_size: Size { w: 6.0, h: 3.0 },
            default_size: Size { w: 3.0, h: 2.0 },
            default_size_sm: Size { w: 2.0, h: 2.0 },
        }
    }

    fn item(id: &str, x: f64, y: f64, w: f64, h: f64) -> LayoutItem {
        LayoutItem {
            id: id.to_owned(),
            card_type: "reading-progress".to_owned(),
            x,
            y,
            w,
            h,
            config: None,
            extra: Map::new(),
        }
    }

    #[test]
    fn floors_follow_the_column_count() {
        let limit = stat_limit("reading-progress");
        let mobile = floors(&limit, 4.0);
        assert_eq!((mobile.min_w, mobile.min_h, mobile.max_w), (2.0, 2.0, 4.0));
        let desktop = floors(&limit, 12.0);
        assert_eq!(
            (desktop.min_w, desktop.min_h, desktop.max_w),
            (3.0, 2.0, 6.0)
        );
    }

    #[test]
    fn normalize_clamps_size_and_keeps_the_card_on_the_grid() {
        let limits = [stat_limit("reading-progress")];
        let out = normalize_item(&item("a", 11.0, 0.0, 1.0, 1.0), &limits, 12.0).unwrap();
        assert_eq!((out.x, out.w, out.h), (9.0, 3.0, 2.0));
        assert_eq!(out.id, "a");
    }

    #[test]
    fn unknown_card_type_is_an_error() {
        let err = normalize_item(&item("a", 0.0, 0.0, 3.0, 2.0), &[], 12.0).unwrap_err();
        assert_eq!(err, UnknownCardType("reading-progress".to_owned()));
    }

    #[test]
    fn compact_stacks_overlapping_cards_upward() {
        let out = compact_vertical(
            &[item("a", 0.0, 0.0, 3.0, 2.0), item("b", 0.0, 0.0, 3.0, 2.0)],
            12.0,
        );
        let b = out.iter().find(|p| p.id == "b").unwrap();
        assert_eq!(b.y, 2.0);
    }

    #[test]
    fn close_gaps_moves_a_card_into_the_hole_and_widens_it() {
        let limits = [stat_limit("reading-progress")];
        let items = [item("a", 0.0, 0.0, 3.0, 2.0), item("b", 6.0, 0.0, 3.0, 2.0)];
        let out = close_gaps(&items, &limits, 12.0).unwrap();
        let b = out.iter().find(|p| p.id == "b").unwrap();
        assert_eq!((b.x, b.y, b.w), (3.0, 0.0, 6.0));
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn pack_sm_snaps_width_and_packs_row_major() {
        let limits = [stat_limit("reading-progress")];
        let items = [item("a", 0.0, 0.0, 2.0, 2.0), item("b", 0.0, 1.0, 3.0, 2.0)];
        let out = pack_sm(&items, &limits).unwrap();
        let b = out.iter().find(|p| p.id == "b").unwrap();
        assert_eq!((b.w, b.x, b.y), (4.0, 0.0, 2.0));
    }
}
