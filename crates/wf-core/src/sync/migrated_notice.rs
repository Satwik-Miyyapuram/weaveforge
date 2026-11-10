//! The warning for a data dir the new app has copied. Port of `migratedNotice` in
//! `apps/shell/sidecar/src/migrated-notice.ts`; reading the marker file stays in TypeScript.

use serde_json::Value;

use super::instant::parse_instant;

/// The warning for the marker's text, or `None` when there is no marker (`raw` is `None`).
/// A marker that is not the JSON the new app writes still gets the warning, without a date.
#[must_use]
pub fn migrated_notice(raw: Option<&str>) -> Option<String> {
    let raw = raw?;
    Some(format!(
        "Your WeaveForge data was copied to the new WeaveForge app{}. Changes you make in this version stay here and do not reach the new app, so use the new app instead.",
        when_of(raw)
    ))
}

/// " on <date>" from the marker's `at`, or "" when `at` is missing or not a parseable date.
fn when_of(raw: &str) -> String {
    let at = match serde_json::from_str::<Value>(raw) {
        Ok(Value::Object(map)) => match map.get("at") {
            Some(Value::String(at)) => at.clone(),
            _ => return String::new(),
        },
        _ => return String::new(),
    };
    if parse_instant(&at).is_none() {
        return String::new();
    }
    format!(" on {}", at.chars().take(10).collect::<String>())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_marker_is_no_notice() {
        assert_eq!(migrated_notice(None), None);
    }

    #[test]
    fn a_dated_marker_carries_the_date() {
        let notice = migrated_notice(Some(r#"{"to":"/new","at":"2026-10-30T08:00:00.000Z"}"#))
            .expect("notice");
        assert!(notice.contains(" on 2026-10-30."));
        assert!(notice.starts_with(
            "Your WeaveForge data was copied to the new WeaveForge app on 2026-10-30."
        ));
    }

    #[test]
    fn a_marker_that_is_not_the_new_apps_json_has_no_date() {
        for raw in [
            "not json",
            "",
            "[]",
            "{}",
            r#"{"at":5}"#,
            r#"{"at":"nope"}"#,
        ] {
            let notice = migrated_notice(Some(raw)).expect("notice");
            assert!(notice.ends_with("new WeaveForge app. Changes you make in this version stay here and do not reach the new app, so use the new app instead."), "{raw}");
            assert!(!notice.contains(" on "), "{raw}");
        }
    }
}
