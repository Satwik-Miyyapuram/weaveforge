//! Which sidebar groups are unfolded (DA-88), as pure list logic.
//!
//! The group you are in is always open; the others keep whatever the reader
//! last chose. Reading and writing localStorage stays in the TypeScript shell
//! (`apps/web/src/app/nav-open-groups.ts`); this module only decides the list.

use serde_json::Value;

/// `groups` plus `active` at the end, unless `active` is absent, empty or already there.
#[must_use]
pub fn with_active(groups: &[String], active: Option<&str>) -> Vec<String> {
    let mut out = groups.to_vec();
    if let Some(a) = active.filter(|a| !a.is_empty())
        && !out.iter().any(|g| g == a)
    {
        out.push(a.to_owned());
    }
    out
}

/// `groups` without `key` when it is open, with it appended when it is closed.
#[must_use]
pub fn toggle_group(groups: &[String], key: &str) -> Vec<String> {
    if groups.iter().any(|g| g == key) {
        groups
            .iter()
            .filter(|g| g.as_str() != key)
            .cloned()
            .collect()
    } else {
        let mut out = groups.to_vec();
        out.push(key.to_owned());
        out
    }
}

/// The saved list from its stored JSON. Missing, junk or non-array storage gives
/// an empty list, and non-string entries are dropped.
#[must_use]
pub fn parse_saved(raw: Option<&str>) -> Vec<String> {
    let Some(raw) = raw else { return Vec::new() };
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::Array(items)) => items
            .into_iter()
            .filter_map(|v| match v {
                Value::String(s) => Some(s),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// The open groups on load: the saved list, with the current group forced open.
#[must_use]
pub fn load_open_groups(raw: Option<&str>, active: Option<&str>) -> Vec<String> {
    with_active(&parse_saved(raw), active)
}

/// The stored form of an open-groups list: a JSON array of strings.
#[must_use]
pub fn encode_open_groups(groups: &[String]) -> String {
    serde_json::to_string(groups).unwrap_or_else(|_| "[]".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn active_group_is_added_once() {
        assert_eq!(with_active(&v(&["work"]), Some("work")), v(&["work"]));
        assert_eq!(with_active(&v(&["work"]), None), v(&["work"]));
        assert_eq!(with_active(&v(&["work"]), Some("")), v(&["work"]));
        assert_eq!(
            with_active(&v(&["library"]), Some("work")),
            v(&["library", "work"])
        );
    }

    #[test]
    fn toggling_opens_and_closes() {
        assert_eq!(
            toggle_group(&v(&["work"]), "library"),
            v(&["work", "library"])
        );
        assert_eq!(
            toggle_group(&v(&["work", "library"]), "work"),
            v(&["library"])
        );
    }

    #[test]
    fn saved_groups_survive_and_active_is_forced_open() {
        let saved = encode_open_groups(&v(&["library", "write"]));
        assert_eq!(
            load_open_groups(Some(&saved), Some("work")),
            v(&["library", "write", "work"])
        );
    }

    #[test]
    fn junk_or_missing_storage_gives_only_the_active_group() {
        assert_eq!(
            load_open_groups(Some("{not json"), Some("write")),
            v(&["write"])
        );
        assert!(parse_saved(Some(r#"{"a":1}"#)).is_empty());
        assert!(parse_saved(None).is_empty());
        assert_eq!(load_open_groups(None, Some("work")), v(&["work"]));
    }

    #[test]
    fn non_string_entries_are_dropped() {
        assert_eq!(parse_saved(Some(r#"["a",1,null,"b"]"#)), v(&["a", "b"]));
    }

    #[test]
    fn encodes_as_a_json_array() {
        assert_eq!(encode_open_groups(&v(&["a", "b"])), r#"["a","b"]"#);
        assert_eq!(encode_open_groups(&[]), "[]");
    }
}
