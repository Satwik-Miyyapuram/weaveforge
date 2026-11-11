//! Dashboard grid layout rules. The parse check is a port of
//! `packages/core/src/features/dashboard/domain/parse-dashboard-layout.ts`. The rest are the
//! pure parts of `apps/web/src/features/dashboard/application/parts.ts`: presets,
//! appending and syncing cards, id-keyed merges and repair checks. Card ids are passed in,
//! never minted here, and card size limits are passed as data from the TS card registry.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::packing::{
    CardLimit, LayoutItem, Size, UnknownCardType, compact_vertical, floors, normalize_item, pack_sm,
};

/// Every dashboard card type id, in the TS order (`DASHBOARD_CARD_TYPES`).
pub const DASHBOARD_CARD_TYPES: [&str; 11] = [
    "reading-progress",
    "report-progress",
    "plan-progress",
    "experiments-summary",
    "needs-attention",
    "recent-log",
    "library-snapshot",
    "top-tags",
    "team-roster",
    "team-attention",
    "supervisee-snapshot",
];

/// A card: string `id`, known `type`, numeric `x`, `y`, `w`, `h`. Other keys pass through.
fn is_layout_item(v: &Value) -> bool {
    let Value::Object(o) = v else { return false };
    let num = |k: &str| o.get(k).is_some_and(Value::is_number);
    o.get("id").is_some_and(Value::is_string)
        && o.get("type")
            .and_then(Value::as_str)
            .is_some_and(|t| DASHBOARD_CARD_TYPES.contains(&t))
        && ["x", "y", "w", "h"].into_iter().all(num)
}

/// Only the valid cards, each unchanged.
fn valid_items(items: &[Value]) -> Value {
    Value::Array(
        items
            .iter()
            .filter(|v| is_layout_item(v))
            .cloned()
            .collect(),
    )
}

/// The `{ lg, sm }` layout with each invalid card dropped (so an unknown card type does
/// not lose the rest), or `None` when `lg` or `sm` is not an array. No compaction.
#[must_use]
pub fn parse_dashboard_layout(raw: &Value) -> Option<Value> {
    let Value::Object(o) = raw else { return None };
    let (Some(Value::Array(lg)), Some(Value::Array(sm))) = (o.get("lg"), o.get("sm")) else {
        return None;
    };
    let mut out = Map::new();
    let _ = out.insert("lg".into(), valid_items(lg));
    let _ = out.insert("sm".into(), valid_items(sm));
    Some(Value::Object(out))
}

/// A `{ lg, sm }` dashboard layout: one card list per breakpoint.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct DashboardLayout {
    /// Desktop cards, on a 12-column grid.
    pub lg: Vec<LayoutItem>,
    /// Mobile cards, on a 4-column grid.
    pub sm: Vec<LayoutItem>,
}

/// A react-grid-layout position for one card, as the grid reports it.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RglPosition {
    /// Card id (`i` in react-grid-layout).
    pub i: String,
    /// Column of the top-left cell.
    pub x: f64,
    /// Row of the top-left cell.
    pub y: f64,
    /// Width in columns.
    pub w: f64,
    /// Height in rows.
    pub h: f64,
}

/// Cards every supervisor layout should have, in the order they are appended.
const SUPERVISOR_ONLY_TYPES: [&str; 3] = ["team-roster", "team-attention", "supervisee-snapshot"];

/// A card with no per-card settings.
fn card(id: &str, card_type: &str, x: f64, y: f64, w: f64, h: f64) -> LayoutItem {
    LayoutItem {
        id: id.into(),
        card_type: card_type.into(),
        x,
        y,
        w,
        h,
        config: None,
        extra: Map::new(),
    }
}

/// Student default, desktop (12 columns).
fn student_default_lg() -> Vec<LayoutItem> {
    vec![
        card("reading", "reading-progress", 0.0, 0.0, 3.0, 2.0),
        card("report", "report-progress", 3.0, 0.0, 3.0, 2.0),
        card("plan", "plan-progress", 6.0, 0.0, 3.0, 2.0),
        card("experiments", "experiments-summary", 9.0, 0.0, 3.0, 2.0),
        // Attention sits beside the library rather than across the whole row: a short
        // list stretched over twelve columns read as mostly empty space.
        card("attention", "needs-attention", 0.0, 2.0, 8.0, 3.0),
        card("library", "library-snapshot", 8.0, 2.0, 4.0, 3.0),
        card("log", "recent-log", 0.0, 5.0, 12.0, 3.0),
    ]
}

/// Student default, mobile (4 columns, 2-column stat tiles).
fn student_default_sm() -> Vec<LayoutItem> {
    vec![
        card("reading", "reading-progress", 0.0, 0.0, 2.0, 2.0),
        card("report", "report-progress", 2.0, 0.0, 2.0, 2.0),
        card("plan", "plan-progress", 0.0, 2.0, 2.0, 2.0),
        card("experiments", "experiments-summary", 2.0, 2.0, 2.0, 2.0),
        card("attention", "needs-attention", 0.0, 4.0, 4.0, 3.0),
        card("log", "recent-log", 0.0, 7.0, 4.0, 4.0),
        card("library", "library-snapshot", 0.0, 11.0, 4.0, 2.0),
    ]
}

/// Supervisor default, desktop.
fn supervisor_default_lg() -> Vec<LayoutItem> {
    vec![
        card("team", "team-roster", 0.0, 0.0, 12.0, 4.0),
        card("team-attn", "team-attention", 0.0, 4.0, 12.0, 3.0),
        card("reading", "reading-progress", 0.0, 7.0, 3.0, 2.0),
        card("report", "report-progress", 3.0, 7.0, 3.0, 2.0),
        card("plan", "plan-progress", 6.0, 7.0, 3.0, 2.0),
        card("experiments", "experiments-summary", 9.0, 7.0, 3.0, 2.0),
        card("log", "recent-log", 0.0, 9.0, 12.0, 3.0),
    ]
}

/// Supervisor default, mobile.
fn supervisor_default_sm() -> Vec<LayoutItem> {
    vec![
        card("team", "team-roster", 0.0, 0.0, 4.0, 5.0),
        card("team-attn", "team-attention", 0.0, 5.0, 4.0, 4.0),
        card("reading", "reading-progress", 0.0, 9.0, 2.0, 2.0),
        card("report", "report-progress", 2.0, 9.0, 2.0, 2.0),
        card("plan", "plan-progress", 0.0, 11.0, 2.0, 2.0),
        card("experiments", "experiments-summary", 2.0, 11.0, 2.0, 2.0),
        card("log", "recent-log", 0.0, 13.0, 4.0, 4.0),
    ]
}

/// The layout a new dashboard starts from: the supervisor or the student default.
#[must_use]
pub fn default_layout(supervisor: bool) -> DashboardLayout {
    if supervisor {
        DashboardLayout {
            lg: supervisor_default_lg(),
            sm: supervisor_default_sm(),
        }
    } else {
        DashboardLayout {
            lg: student_default_lg(),
            sm: student_default_sm(),
        }
    }
}

/// The size limits for `card_type`.
///
/// # Errors
///
/// Fails when `limits` has no entry for the card type.
fn find_limit<'a>(
    limits: &'a [CardLimit],
    card_type: &str,
) -> Result<&'a CardLimit, UnknownCardType> {
    limits
        .iter()
        .find(|l| l.card_type == card_type)
        .ok_or_else(|| UnknownCardType(card_type.to_owned()))
}

/// Normalize both breakpoints and pack them: compact desktop, pack mobile.
///
/// # Errors
///
/// Fails when a card type has no entry in `limits`.
pub fn finalize_dashboard_layout(
    layout: &DashboardLayout,
    limits: &[CardLimit],
) -> Result<DashboardLayout, UnknownCardType> {
    let lg = layout
        .lg
        .iter()
        .map(|it| normalize_item(it, limits, 12.0))
        .collect::<Result<Vec<_>, _>>()?;
    let sm = layout
        .sm
        .iter()
        .map(|it| normalize_item(it, limits, 4.0))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(DashboardLayout {
        lg: compact_vertical(&lg, 12.0),
        sm: pack_sm(&sm, limits)?,
    })
}

/// Add the supervisor-only cards that are missing from `layout.lg`. `ids` supplies one new
/// card id per entry of [`SUPERVISOR_ONLY_TYPES`], in the same order; extra ids are unused.
/// Cards already present are left as they are.
///
/// # Errors
///
/// Fails when a card type has no entry in `limits`.
pub fn merge_supervisor_cards(
    layout: &DashboardLayout,
    limits: &[CardLimit],
    ids: &[String],
) -> Result<DashboardLayout, UnknownCardType> {
    let present: HashSet<&str> = layout.lg.iter().map(|c| c.card_type.as_str()).collect();
    let mut next = layout.clone();
    for (card_type, id) in SUPERVISOR_ONLY_TYPES.iter().zip(ids) {
        if present.contains(card_type) {
            continue;
        }
        next = append_card_pair(&next, card_type, id, limits)?;
    }
    Ok(next)
}

/// Append a card to the bottom of both breakpoints under one shared `id`, then finalize.
///
/// # Errors
///
/// Fails when `card_type` has no entry in `limits`.
pub fn append_card_pair(
    layout: &DashboardLayout,
    card_type: &str,
    id: &str,
    limits: &[CardLimit],
) -> Result<DashboardLayout, UnknownCardType> {
    let def = find_limit(limits, card_type)?;
    let next = DashboardLayout {
        lg: append_card(&layout.lg, card_type, id, def.default_size, 12.0),
        sm: append_card(&layout.sm, card_type, id, def.default_size_sm, 4.0),
    };
    finalize_dashboard_layout(&next, limits)
}

/// The card placed at the bottom of `items`, at its default size clamped to `cols`.
fn append_card(
    items: &[LayoutItem],
    card_type: &str,
    id: &str,
    size: Size,
    cols: f64,
) -> Vec<LayoutItem> {
    let max_y = items.iter().fold(0.0_f64, |m, it| m.max(it.y + it.h));
    let mut out = items.to_vec();
    out.push(LayoutItem {
        id: id.into(),
        card_type: card_type.into(),
        x: 0.0,
        y: max_y,
        w: size.w.min(cols),
        h: size.h,
        config: None,
        extra: Map::new(),
    });
    out
}

/// Repair id drift between the breakpoints. When the ids differ, each desktop card keeps its
/// mobile card if it has one, else gets a default mobile size. Desktop is canonical.
///
/// # Errors
///
/// Fails when a card type has no entry in `limits`.
pub fn sync_dashboard_layouts(
    layout: &DashboardLayout,
    limits: &[CardLimit],
) -> Result<DashboardLayout, UnknownCardType> {
    let lg_ids: HashSet<&str> = layout.lg.iter().map(|c| c.id.as_str()).collect();
    let sm_ids: HashSet<&str> = layout.sm.iter().map(|c| c.id.as_str()).collect();
    if lg_ids.len() == sm_ids.len() && lg_ids.iter().all(|id| sm_ids.contains(id)) {
        return Ok(layout.clone());
    }
    let sm_by_id: HashMap<&str, &LayoutItem> =
        layout.sm.iter().map(|c| (c.id.as_str(), c)).collect();
    let mut synced = Vec::with_capacity(layout.lg.len());
    for lg_item in &layout.lg {
        if let Some(sm_item) = sm_by_id.get(lg_item.id.as_str()) {
            synced.push((*sm_item).clone());
            continue;
        }
        let def = find_limit(limits, &lg_item.card_type)?;
        synced.push(LayoutItem {
            x: 0.0,
            y: 0.0,
            w: def.default_size_sm.w,
            h: def.default_size_sm.h,
            ..lg_item.clone()
        });
    }
    finalize_dashboard_layout(
        &DashboardLayout {
            lg: layout.lg.clone(),
            sm: synced,
        },
        limits,
    )
}

/// Take the grid's positions for `items` (matched by id) and normalize each to `cols`.
///
/// # Errors
///
/// Fails when a card type has no entry in `limits`.
pub fn merge_rgl_positions(
    items: &[LayoutItem],
    rgl: &[RglPosition],
    limits: &[CardLimit],
    cols: f64,
) -> Result<Vec<LayoutItem>, UnknownCardType> {
    let by_id: HashMap<&str, &RglPosition> = rgl.iter().map(|r| (r.i.as_str(), r)).collect();
    items
        .iter()
        .map(|it| {
            let merged = match by_id.get(it.id.as_str()) {
                Some(pos) => LayoutItem {
                    x: pos.x,
                    y: pos.y,
                    w: pos.w,
                    h: pos.h,
                    ..it.clone()
                },
                None => it.clone(),
            };
            normalize_item(&merged, limits, cols)
        })
        .collect()
}

/// True when a desktop card is narrower than its minimum width at 12 columns.
///
/// # Errors
///
/// Fails when a card type has no entry in `limits`.
pub fn lg_layout_needs_repair(
    items: &[LayoutItem],
    limits: &[CardLimit],
) -> Result<bool, UnknownCardType> {
    for it in items {
        let def = find_limit(limits, &it.card_type)?;
        if it.w < floors(def, 12.0).min_w {
            return Ok(true);
        }
    }
    Ok(false)
}

/// A string that changes whenever any card's id or box changes.
#[must_use]
pub fn layout_signature(items: &[LayoutItem]) -> String {
    items
        .iter()
        .map(|it| format!("{}:{},{},{},{}", it.id, it.x, it.y, it.w, it.h))
        .collect::<Vec<_>>()
        .join("|")
}

/// True when the mobile cards are not already in the packed order.
///
/// # Errors
///
/// Fails when a card type has no entry in `limits`.
pub fn sm_layout_needs_repack(
    items: &[LayoutItem],
    limits: &[CardLimit],
) -> Result<bool, UnknownCardType> {
    let packed = pack_sm(items, limits)?;
    Ok(layout_signature(items) != layout_signature(&packed))
}

/// The cache slot for one project's layout: one per project and per supervisor or student
/// layout (TS `layoutCacheKey`).
#[must_use]
pub fn cache_key(project_id: &str, supervisor_layout: bool) -> String {
    let role = if supervisor_layout {
        "supervisor"
    } else {
        "student"
    };
    format!("{project_id}:{role}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cache_key_separates_projects_and_roles() {
        assert_eq!(cache_key("p1", true), "p1:supervisor");
        assert_eq!(cache_key("p1", false), "p1:student");
        assert_ne!(cache_key("p1", true), cache_key("p2", true));
    }

    #[test]
    fn keeps_valid_cards_whole() {
        let card = json!({ "id": "a", "type": "top-tags", "x": 0, "y": 1, "w": 2, "h": 3, "config": { "n": 5 } });
        let raw = json!({ "lg": [card.clone()], "sm": [], "extra": 1 });
        assert_eq!(
            parse_dashboard_layout(&raw),
            Some(json!({ "lg": [card], "sm": [] }))
        );
    }

    #[test]
    fn drops_bad_cards_and_rejects_bad_lists() {
        assert_eq!(parse_dashboard_layout(&json!(null)), None);
        assert_eq!(parse_dashboard_layout(&json!({ "lg": [] })), None);
        let good = json!({ "id": "b", "type": "recent-log", "x": 0, "y": 0, "w": 1, "h": 1 });
        let bad = json!({ "id": "a", "type": "nope", "x": 0, "y": 0, "w": 1, "h": 1 });
        let short = json!({ "id": "a", "type": "top-tags", "x": 0, "y": 0, "w": "1", "h": 1 });
        let raw = json!({ "lg": [short, good.clone()], "sm": [bad, 3] });
        assert_eq!(
            parse_dashboard_layout(&raw),
            Some(json!({ "lg": [good], "sm": [] }))
        );
    }
}
