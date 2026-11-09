//! Recent-query list rules (TS `search-history.ts`). Pure: the web app supplies
//! the storage.

use serde_json::Value;

/// Default cap on the recent-query list.
pub const MAX_SEARCH_HISTORY: usize = 12;

/// Prepend a query, most-recent first. Repeating a query moves it to the front,
/// and a query that extends the previous one replaces its abandoned prefixes.
/// An empty query leaves the list unchanged. `max` is floored at 1.
pub fn remember_search_query(history: &[String], query: &str, max: usize) -> Vec<String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return history.to_vec();
    }
    let lower = trimmed.to_lowercase();
    let mut out = vec![trimmed.to_string()];
    for entry in history {
        let other = entry.trim().to_lowercase();
        if other == lower || lower.starts_with(&other) {
            continue;
        }
        out.push(entry.clone());
    }
    out.truncate(max.max(1));
    out
}

/// Remove every entry equal to `query`, ignoring case and surrounding space.
pub fn forget_search_query(history: &[String], query: &str) -> Vec<String> {
    let target = query.trim().to_lowercase();
    history
        .iter()
        .filter(|entry| entry.trim().to_lowercase() != target)
        .cloned()
        .collect()
}

/// Keep usable query strings only: non-empty, trimmed, de-duplicated
/// case-insensitively, first occurrence wins, capped at `max`. Anything that is
/// not an array yields an empty list.
pub fn normalize_search_history(raw: &Value, max: usize) -> Vec<String> {
    let Some(items) = raw.as_array() else {
        return Vec::new();
    };
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for item in items {
        let Some(text) = item.as_str() else { continue };
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !seen.insert(trimmed.to_lowercase()) {
            continue;
        }
        out.push(trimmed.to_string());
        if out.len() >= max {
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn s(items: &[&str]) -> Vec<String> {
        items.iter().map(|v| (*v).to_string()).collect()
    }

    #[test]
    fn remember_moves_repeat_to_front() {
        assert_eq!(
            remember_search_query(&s(&["latent", "graph"]), "graph", MAX_SEARCH_HISTORY),
            s(&["graph", "latent"])
        );
    }

    #[test]
    fn remember_replaces_abandoned_prefixes() {
        let mut history = Vec::new();
        for q in ["att", "atten", "attention"] {
            history = remember_search_query(&history, q, MAX_SEARCH_HISTORY);
        }
        assert_eq!(history, s(&["attention"]));
    }

    #[test]
    fn remember_caps_and_floors_max() {
        let mut history = Vec::new();
        for i in 0..20 {
            history = remember_search_query(&history, &format!("query {i}"), 5);
        }
        assert_eq!(history.len(), 5);
        assert_eq!(history[0], "query 19");
        assert_eq!(remember_search_query(&s(&["a"]), "b", 0), s(&["b"]));
    }

    #[test]
    fn remember_ignores_blank_query() {
        assert_eq!(remember_search_query(&s(&["latent"]), "   ", MAX_SEARCH_HISTORY), s(&["latent"]));
    }

    #[test]
    fn forget_ignores_case_and_space() {
        assert_eq!(forget_search_query(&s(&["Latent", "graph"]), " latent "), s(&["graph"]));
    }

    #[test]
    fn normalize_drops_non_strings_blanks_and_duplicates() {
        let raw = json!(["a", 3, "", "  b ", "A", null]);
        assert_eq!(normalize_search_history(&raw, MAX_SEARCH_HISTORY), s(&["a", "b"]));
    }

    #[test]
    fn normalize_non_array_is_empty() {
        assert!(normalize_search_history(&json!("not an array"), MAX_SEARCH_HISTORY).is_empty());
    }

    #[test]
    fn normalize_respects_max() {
        let raw = json!(["a", "b", "c"]);
        assert_eq!(normalize_search_history(&raw, 2), s(&["a", "b"]));
    }
}
