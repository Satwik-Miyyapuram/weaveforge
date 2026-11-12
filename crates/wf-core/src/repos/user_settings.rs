//! The `user_settings` row queries, Rust-planned.
//!
//! Ported from the query half of `PostgrestSettingsRepository` in
//! `apps/web/src/features/settings/infrastructure/parts.ts`. The memo and the sealed
//! credentials (an HTTP route) stay in TS. One row per user: reads rely on row-level
//! security to pick the caller's row.

use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::ai::access_policy::{AiAccessSettingsInput, normalize_ai_access_settings};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep};
use crate::settings::user_appearance::{UserAppearance, normalize_appearance};
use crate::settings::user_settings::{CURRENT_DISCLAIMER_VERSION, normalize_user_settings};

const TABLE: &str = "user_settings";

/// The columns a settings row is read as, named rather than starred.
pub const SETTINGS_COLUMNS: &str =
    "user_id,zotero_library,disclaimer_accepted_at,disclaimer_version,appearance,ai_access";

const METADATA_COLUMNS: &str = "disclaimer_accepted_at,disclaimer_version,appearance";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "row" => row(call),
        "metadata" => metadata(call),
        "saveRow" => save_row(call),
        "saveAppearance" => save_appearance(call),
        "saveDisclaimer" => save_disclaimer(call),
        "acceptDisclaimer" => accept_disclaimer(call),
        _ => return None,
    })
}

fn read(columns: &str) -> RepoQuery {
    RepoQuery::select(TABLE, columns).maybe_single()
}

/// Reply `i` as a row object, or `None` when there is no row.
fn reply_row(call: &RepoCall, i: usize) -> Result<Option<Map<String, Value>>, RepoStep> {
    match call.replies.get(i) {
        None => Err(RepoStep::fail(format!("reply {i} missing"))),
        Some(Value::Object(map)) => Ok(Some(map.clone())),
        Some(_) => Ok(None),
    }
}

/// `row()`: the caller's raw settings row, or `null`.
fn row(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(read(SETTINGS_COLUMNS));
    }
    match reply_row(call, 0) {
        Ok(row) => RepoStep::done(&row),
        Err(step) => step,
    }
}

/// `SettingsMetadata`.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Metadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    disclaimer_accepted_at: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    disclaimer_version: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    appearance: Option<UserAppearance>,
}

/// A non-null column value.
fn present(row: &Map<String, Value>, column: &str) -> Option<Value> {
    row.get(column).filter(|v| !v.is_null()).cloned()
}

fn appearance(row: &Map<String, Value>) -> Option<UserAppearance> {
    normalize_appearance(row.get("appearance").unwrap_or(&Value::Null))
}

/// `metadata()`: disclaimer and appearance, `{}` without a row.
fn metadata(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(read(METADATA_COLUMNS));
    }
    match reply_row(call, 0) {
        Ok(None) => RepoStep::done(&Metadata::default()),
        Ok(Some(row)) => RepoStep::done(&Metadata {
            disclaimer_accepted_at: present(&row, "disclaimer_accepted_at"),
            disclaimer_version: present(&row, "disclaimer_version"),
            appearance: appearance(&row),
        }),
        Err(step) => step,
    }
}

/// The stored, normalized AI access settings of a row, if any.
fn ai_access(row: &Map<String, Value>) -> Result<Option<Value>, String> {
    let Some(raw) = present(row, "ai_access") else {
        return Ok(None);
    };
    let input: AiAccessSettingsInput = serde_json::from_value(raw).map_err(|e| e.to_string())?;
    serde_json::to_value(normalize_ai_access_settings(Some(&input)))
        .map(Some)
        .map_err(|e| e.to_string())
}

/// Read the stored row, then write what `build` makes of it. The caller checks the user first.
fn read_then_write(
    call: &RepoCall,
    build: impl FnOnce(&Map<String, Value>) -> Result<RepoQuery, String>,
) -> RepoStep {
    match call.replies.len() {
        // Read through, not from a memo: another tab may have just written.
        0 => RepoStep::send(read(SETTINGS_COLUMNS)),
        1 => {
            let existing = match reply_row(call, 0) {
                Ok(row) => row.unwrap_or_default(),
                Err(step) => return step,
            };
            match build(&existing) {
                Ok(query) => RepoStep::send(query),
                Err(e) => RepoStep::fail(e),
            }
        }
        _ => RepoStep::unit(),
    }
}

/// The upsert of `settings` (already normalized) over the stored `existing` row. A field the
/// settings leave unset keeps its stored value; the library has no stored fallback. The body
/// never names the credentials column, so it is untouched.
fn merged_upsert(
    call: &RepoCall,
    user: &str,
    existing: &Map<String, Value>,
    settings: &Value,
) -> Result<RepoQuery, String> {
    let stored_ai = ai_access(existing)?;
    let given = |key: &str| settings.get(key).filter(|v| !v.is_null()).cloned();
    let or_null = |v: Option<Value>| v.unwrap_or(Value::Null);
    Ok(RepoQuery::upsert(
        TABLE,
        json!({
            "user_id": user,
            "zotero_library": or_null(given("zoteroLibrary")),
            "disclaimer_accepted_at": or_null(given("disclaimerAcceptedAt")
                .or_else(|| present(existing, "disclaimer_accepted_at"))),
            "disclaimer_version": or_null(given("disclaimerVersion")
                .or_else(|| present(existing, "disclaimer_version"))),
            "appearance": or_null(given("appearance")
                .or_else(|| appearance(existing).and_then(|a| serde_json::to_value(a).ok()))),
            "ai_access": or_null(given("aiAccess").or(stored_ai)),
            "updated_at": call.now(),
        }),
    )
    .on_conflict("user_id", false))
}

/// `saveRow(settings)`: the non-secret fields, read-modify-write. The settings are normalized
/// first (TS `save`). Unset disclaimer, appearance and AI access keep the stored values; the
/// credentials column is untouched.
fn save_row(call: &RepoCall) -> RepoStep {
    let user = match call.user() {
        Ok(user) => user,
        Err(step) => return step,
    };
    read_then_write(call, |existing| {
        let settings = normalize_user_settings(call.arg(0));
        merged_upsert(call, user, existing, &settings)
    })
}

/// `saveAppearance(appearance)`: merge the given appearance over the stored one, normalize it,
/// and save it with the stored library (TS `saveAppearance`).
fn save_appearance(call: &RepoCall) -> RepoStep {
    let user = match call.user() {
        Ok(user) => user,
        Err(step) => return step,
    };
    read_then_write(call, |existing| {
        let mut merged = match existing.get("appearance") {
            Some(Value::Object(stored)) => stored.clone(),
            _ => Map::new(),
        };
        if let Some(given) = call.arg(0).as_object() {
            merged.extend(given.iter().map(|(k, v)| (k.clone(), v.clone())));
        }
        let mut settings = Map::new();
        if let Some(library) = present(existing, "zotero_library") {
            let _ = settings.insert("zoteroLibrary".to_owned(), library);
        }
        if let Some(next) = normalize_appearance(&Value::Object(merged))
            && let Ok(value) = serde_json::to_value(next)
        {
            let _ = settings.insert("appearance".to_owned(), value);
        }
        let settings = normalize_user_settings(&Value::Object(settings));
        merged_upsert(call, user, existing, &settings)
    })
}

/// The upsert that records a disclaimer acceptance, keeping the rest of the row.
fn disclaimer_upsert(call: &RepoCall, user: &str, accepted_at: &str, version: &Value) -> RepoQuery {
    RepoQuery::upsert(
        TABLE,
        json!({
            "user_id": user,
            "disclaimer_accepted_at": accepted_at,
            "disclaimer_version": version,
            "updated_at": call.now(),
        }),
    )
    .on_conflict("user_id", false)
}

/// `saveDisclaimer(acceptedAt, version)`.
fn save_disclaimer(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    match call.user() {
        Ok(user) => RepoStep::send(disclaimer_upsert(call, user, call.text(0), call.arg(1))),
        Err(step) => step,
    }
}

/// `acceptDisclaimer()`: accept the current disclaimer version at the call's time (TS
/// `acceptDisclaimer`, which takes the time from its clock).
fn accept_disclaimer(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    match call.user() {
        Ok(user) => RepoStep::send(disclaimer_upsert(
            call,
            user,
            call.now(),
            &json!(CURRENT_DISCLAIMER_VERSION),
        )),
        Err(step) => step,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                user_id: Some("u1".into()),
                now: Some("2026-11-11T10:00:00Z".into()),
                ..RepoCtx::default()
            },
        }
    }

    fn sent(step: RepoStep) -> RepoQuery {
        match step {
            RepoStep::Send { mut queries } => queries.remove(0),
            other => panic!("expected send, got {other:?}"),
        }
    }

    fn done(step: RepoStep) -> Value {
        match step {
            RepoStep::Done { value } => value,
            other => panic!("expected done, got {other:?}"),
        }
    }

    fn stored() -> Value {
        json!({ "user_id": "u1", "zotero_library": "users/1", "disclaimer_accepted_at": "2026-01-01",
            "disclaimer_version": 2, "appearance": null,
            "ai_access": { "enabled": true, "readCategories": ["paper_metadata"] } })
    }

    #[test]
    fn row_reads_the_callers_row_or_null() {
        let q = sent(row(&call(vec![], vec![])));
        assert_eq!(q.columns.as_deref(), Some(SETTINGS_COLUMNS));
        assert!(q.filters.is_empty());
        assert_eq!(done(row(&call(vec![], vec![Value::Null]))), Value::Null);
        assert_eq!(
            done(row(&call(vec![], vec![stored()])))["zotero_library"],
            "users/1"
        );
    }

    #[test]
    fn metadata_drops_nulls_and_is_empty_without_a_row() {
        assert_eq!(done(metadata(&call(vec![], vec![Value::Null]))), json!({}));
        let v = done(metadata(&call(vec![], vec![stored()])));
        assert_eq!(v["disclaimerAcceptedAt"], "2026-01-01");
        assert_eq!(v["disclaimerVersion"], 2);
        assert!(v.get("appearance").is_none());
    }

    #[test]
    fn save_row_reads_then_merges_unset_fields_from_the_stored_row() {
        let settings = json!({ "zoteroLibrary": "users/9" });
        let q = sent(save_row(&call(vec![settings.clone()], vec![])));
        assert_eq!(q.action, RepoAction::Select);
        let q = sent(save_row(&call(vec![settings], vec![stored()])));
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(q.on_conflict.as_deref(), Some("user_id"));
        let body = q.body.unwrap();
        assert_eq!(body["user_id"], "u1");
        assert_eq!(body["zotero_library"], "users/9");
        assert_eq!(body["disclaimer_version"], 2);
        assert_eq!(body["appearance"], Value::Null);
        assert_eq!(body["ai_access"]["enabled"], true);
        assert_eq!(body["updated_at"], "2026-11-11T10:00:00Z");
        assert!(body.get("credentials_enc").is_none());
    }

    #[test]
    fn save_row_prefers_given_fields_and_writes_nulls_without_a_row() {
        let settings = json!({ "disclaimerVersion": 3, "aiAccess": { "enabled": false } });
        let body = sent(save_row(&call(vec![settings], vec![stored()])))
            .body
            .unwrap();
        assert_eq!(body["disclaimer_version"], 3);
        assert_eq!(body["ai_access"]["enabled"], false);
        assert_eq!(body["zotero_library"], Value::Null);
        let body = sent(save_row(&call(vec![json!({})], vec![Value::Null])))
            .body
            .unwrap();
        assert_eq!(body["disclaimer_accepted_at"], Value::Null);
        assert_eq!(body["ai_access"], Value::Null);
    }

    #[test]
    fn writes_need_a_user() {
        let mut c = call(vec![json!("2026-01-01"), json!(1)], vec![]);
        c.ctx.user_id = None;
        assert!(matches!(save_disclaimer(&c), RepoStep::Fail { .. }));
        assert!(matches!(save_row(&c), RepoStep::Fail { .. }));
        assert!(matches!(save_appearance(&c), RepoStep::Fail { .. }));
        assert!(matches!(accept_disclaimer(&c), RepoStep::Fail { .. }));
    }

    #[test]
    fn save_row_trims_the_library_before_writing() {
        let settings = json!({ "zoteroLibrary": "  users/9 " });
        let body = sent(save_row(&call(vec![settings], vec![stored()])))
            .body
            .unwrap();
        assert_eq!(body["zotero_library"], "users/9");
    }

    #[test]
    fn save_appearance_merges_over_the_stored_appearance_and_keeps_the_library() {
        let given = json!({ "darkTheme": "dracula" });
        let q = sent(save_appearance(&call(vec![given.clone()], vec![])));
        assert_eq!(q.action, RepoAction::Select);
        let mut row = stored();
        row["appearance"] = json!({ "mode": "light" });
        let body = sent(save_appearance(&call(vec![given], vec![row])))
            .body
            .unwrap();
        assert_eq!(body["appearance"]["mode"], "light");
        assert_eq!(body["appearance"]["darkTheme"], "dracula");
        assert_eq!(body["zotero_library"], "users/1");
        assert_eq!(body["disclaimer_version"], 2);
        assert!(body.get("credentials_enc").is_none());
        let body = sent(save_appearance(&call(
            vec![json!({ "mode": "dark" })],
            vec![stored()],
        )))
        .body
        .unwrap();
        assert_eq!(body["appearance"]["mode"], "dark");
    }

    #[test]
    fn accept_disclaimer_records_now_and_the_current_version() {
        let q = sent(step("acceptDisclaimer", &call(vec![], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(q.on_conflict.as_deref(), Some("user_id"));
        let body = q.body.unwrap();
        assert_eq!(body["user_id"], "u1");
        assert_eq!(body["disclaimer_accepted_at"], "2026-11-11T10:00:00Z");
        assert_eq!(body["disclaimer_version"], CURRENT_DISCLAIMER_VERSION);
        assert!(body.get("zotero_library").is_none());
        assert!(body.get("credentials_enc").is_none());
        assert_eq!(
            done(accept_disclaimer(&call(vec![], vec![Value::Null]))),
            Value::Null
        );
    }

    #[test]
    fn save_disclaimer_upserts_the_acceptance() {
        let q = sent(
            step(
                "saveDisclaimer",
                &call(vec![json!("2026-01-01"), json!(4)], vec![]),
            )
            .unwrap(),
        );
        let body = q.body.unwrap();
        assert_eq!(body["disclaimer_accepted_at"], "2026-01-01");
        assert_eq!(body["disclaimer_version"], 4);
        assert_eq!(
            done(save_disclaimer(&call(vec![], vec![Value::Null]))),
            Value::Null
        );
    }
}
