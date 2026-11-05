//! Dashboard grid layout check. Port of
//! `packages/core/src/features/dashboard/domain/parse-dashboard-layout.ts`.

use serde_json::{Map, Value};

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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
