//! Zotero Web API library paths and the child-item test (TS `zotero-web-api.ts`). The fetching
//! and paging stay in TypeScript; this module holds the string rules.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value;

use crate::overleaf_workshop::encode_uri_component;
use crate::reader_analysis::lines::js_trim;

use super::source_requests::form_urlencode;

/// Item types that describe a file or a comment about a paper, not a paper (TS `CHILD_ITEM_TYPES`).
const CHILD_ITEM_TYPES: [&str; 3] = ["attachment", "note", "annotation"];

/// The two Zotero item fields that decide whether an item hangs off a paper. Values stay loose
/// because JS truthiness and `?? ""` decide the answer, not a fixed type.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroChildProbe {
    /// Zotero's `itemType`; anything but a string is not a child type.
    #[serde(default)]
    pub item_type: Value,
    /// Zotero's `parentItem`, read by JS truthiness.
    #[serde(default)]
    pub parent_item: Value,
}

/// True when the item hangs off a paper: an attachment, note or annotation, or it has a parent.
#[must_use]
pub fn is_child_item(item: &ZoteroChildProbe) -> bool {
    item.item_type
        .as_str()
        .is_some_and(|kind| CHILD_ITEM_TYPES.contains(&kind))
        || js_truthy(&item.parent_item)
}

/// The API library path for a pasted library: a bare user id becomes `users/<id>`, a
/// `users/<id>` or `groups/<id>` path is kept, anything else is `None` (TS `normalizeZoteroLibrary`).
#[must_use]
pub fn normalize_zotero_library(library: Option<&str>) -> Option<String> {
    let value = js_trim(library?);
    if value.is_empty() {
        return None;
    }
    if is_ascii_digits(value) {
        return Some(format!("users/{value}"));
    }
    let (kind, id) = value.split_once('/')?;
    ((kind == "users" || kind == "groups") && is_ascii_digits(id)).then(|| value.to_owned())
}

/// The API URL for a library path under an origin. Removes one trailing slash from the origin and
/// one leading slash from the path (TS `zoteroLibraryUrl`).
#[must_use]
pub fn zotero_library_url(library: &str, api_origin: &str) -> String {
    let origin = api_origin.strip_suffix('/').unwrap_or(api_origin);
    let path = library.strip_prefix('/').unwrap_or(library);
    format!("{origin}/{path}")
}

/// The top-level items path, inside one collection when it has a key (TS `zoteroTopLevelPath`).
/// An empty key counts as none, as the JS truthiness check does. The key is percent-encoded
/// like `encodeURIComponent`.
#[must_use]
pub fn zotero_top_level_path(collection: Option<&str>) -> String {
    match collection {
        Some(key) if !key.is_empty() => {
            format!("/collections/{}/items/top", encode_uri_component(key))
        }
        _ => "/items/top".to_owned(),
    }
}

/// The headers every Zotero Web API request carries: the API key and the pinned API version (TS
/// `zoteroHeaders`). `BTreeMap` keeps the keys in the order the JS object literal had.
#[must_use]
pub fn zotero_headers(api_key: &str) -> BTreeMap<String, String> {
    BTreeMap::from([
        ("Zotero-API-Key".to_owned(), api_key.to_owned()),
        ("Zotero-API-Version".to_owned(), "3".to_owned()),
    ])
}

/// Non-empty and all ASCII digits, as the JS `/^\d+$/` check reads it.
fn is_ascii_digits(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())
}

/// JS truthiness of a JSON value: null, false, zero and the empty string are falsy.
fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|x| x != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// The backoff ceiling for both the server header and the per-attempt fallback (TS `MAX_BACKOFF_MS`).
const MAX_BACKOFF_MS: f64 = 30_000.0;

/// A header or count read the way `Number(text)` reads it when it must be finite. Blank, missing
/// and non-numeric text give `None`, so a missing header never reads as zero.
fn finite_number(text: Option<&str>) -> Option<f64> {
    let parsed = text?.trim().parse::<f64>().ok()?;
    parsed.is_finite().then_some(parsed)
}

/// The `Total-Results` header as an item count, or `None` when it is absent or unusable (TS
/// `getPage`). `None` sends the caller down the walk-until-short-page fallback.
#[must_use]
pub fn zotero_total_results(header: Option<&str>) -> Option<f64> {
    finite_number(header)
}

/// Offsets of the pages after the first, for `total` items read `page` at a time (TS
/// `fetchAllZoteroItems`). Empty when `page` is zero, since the offset would never advance.
#[must_use]
pub fn zotero_page_starts(total: f64, page: u64) -> Vec<u64> {
    if page == 0 {
        return Vec::new();
    }
    let mut starts = Vec::new();
    let mut start = page;
    while (start as f64) < total {
        starts.push(start);
        start += page;
    }
    starts
}

/// Milliseconds the shared clock waits after a response's `Backoff` header, falling back to
/// `Retry-After` when `Backoff` is absent (TS `BackoffGate.note`). `None` when there is no usable
/// positive value, which leaves the clock where it was.
#[must_use]
pub fn zotero_server_backoff_ms(backoff: Option<&str>, retry_after: Option<&str>) -> Option<f64> {
    let seconds = finite_number(backoff.or(retry_after))?;
    (seconds > 0.0).then(|| (seconds * 1000.0).min(MAX_BACKOFF_MS))
}

/// Milliseconds to back off after a 429 that carried no usable header, by attempt number (TS
/// `BackoffGate.noteAttempt`).
#[must_use]
pub fn zotero_attempt_backoff_ms(attempt: u32) -> f64 {
    (1000.0 * (f64::from(attempt) + 1.0)).min(MAX_BACKOFF_MS)
}

/// Build a Zotero request URL (TS `buildUrl` and `fetchZoteroItemKeys`): `base_url`, the path
/// (default `/items`), then the query. `lead` pairs come first. Each `params` entry with a value
/// is then set: an existing key is replaced in place, a new one is appended, and missing or empty
/// values are skipped, as `URLSearchParams.set` does.
fn request_url(
    base_url: &str,
    path: Option<&str>,
    lead: Vec<(String, String)>,
    params: &[(String, Option<String>)],
) -> String {
    let mut pairs = lead;
    for (key, value) in params {
        let Some(value) = value.as_deref().filter(|text| !text.is_empty()) else {
            continue;
        };
        match pairs.iter_mut().find(|(existing, _)| existing == key) {
            Some(pair) => pair.1 = value.to_owned(),
            None => pairs.push((key.clone(), value.to_owned())),
        }
    }
    let refs: Vec<(&str, &str)> = pairs
        .iter()
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect();
    format!("{base_url}{}?{}", path.unwrap_or("/items"), form_urlencode(&refs))
}

/// The URL for one page of a Zotero read, `limit` and `start` first (TS `buildUrl`).
#[must_use]
pub fn zotero_page_url(
    base_url: &str,
    path: Option<&str>,
    params: &[(String, Option<String>)],
    start: u64,
    limit: u64,
) -> String {
    let lead = vec![
        ("limit".to_owned(), limit.to_string()),
        ("start".to_owned(), start.to_string()),
    ];
    request_url(base_url, path, lead, params)
}

/// The URL for a keys-only read, `format=keys` first (TS `fetchZoteroItemKeys`).
#[must_use]
pub fn zotero_keys_url(
    base_url: &str,
    path: Option<&str>,
    params: &[(String, Option<String>)],
) -> String {
    request_url(
        base_url,
        path,
        vec![("format".to_owned(), "keys".to_owned())],
        params,
    )
}

#[cfg(test)]
mod paging_tests {
    use super::*;

    // Plain-comment tests for the paging and backoff helpers; the TS paginator tests stay in
    // zotero-web-api.test.ts and exercise these through the wasm bindings.

    #[test]
    fn total_results_is_read_only_when_it_is_a_number() {
        // A missing or blank header must not claim the library is empty.
        assert_eq!(zotero_total_results(Some("120")), Some(120.0));
        assert_eq!(zotero_total_results(Some(" 7 ")), Some(7.0));
        assert_eq!(zotero_total_results(Some("")), None);
        assert_eq!(zotero_total_results(Some("   ")), None);
        assert_eq!(zotero_total_results(Some("abc")), None);
        assert_eq!(zotero_total_results(None), None);
    }

    #[test]
    fn page_starts_cover_the_rest_after_the_first_page() {
        assert_eq!(zotero_page_starts(250.0, 100), vec![100, 200]);
        assert_eq!(zotero_page_starts(200.0, 100), vec![100]);
        assert!(zotero_page_starts(100.0, 100).is_empty());
        assert!(zotero_page_starts(0.0, 100).is_empty());
        assert!(zotero_page_starts(500.0, 0).is_empty());
    }

    #[test]
    fn page_url_sets_limit_and_start_first_and_skips_empty_params() {
        let base = "https://api.zotero.org/users/1";
        assert_eq!(
            zotero_page_url(base, None, &[("tag".to_owned(), Some("a b".to_owned()))], 100, 100),
            "https://api.zotero.org/users/1/items?limit=100&start=100&tag=a+b",
        );
        // A param with the same key replaces the lead value in place; empty and missing values drop out.
        let params = [
            ("limit".to_owned(), Some("5".to_owned())),
            ("q".to_owned(), Some(String::new())),
            ("collection".to_owned(), None),
        ];
        assert_eq!(
            zotero_page_url(base, Some("/collections/K/items/top"), &params, 0, 100),
            "https://api.zotero.org/users/1/collections/K/items/top?limit=5&start=0",
        );
    }

    #[test]
    fn keys_url_asks_for_the_key_list_format() {
        assert_eq!(
            zotero_keys_url("https://x", None, &[("tag".to_owned(), Some("t".to_owned()))]),
            "https://x/items?format=keys&tag=t",
        );
    }

    #[test]
    fn server_backoff_uses_backoff_then_retry_after_and_clamps() {
        assert_eq!(zotero_server_backoff_ms(Some("2"), None), Some(2000.0));
        assert_eq!(zotero_server_backoff_ms(None, Some("5")), Some(5000.0));
        assert_eq!(zotero_server_backoff_ms(None, Some("60")), Some(30_000.0));
        // A present but zero Backoff wins over Retry-After and gives no wait.
        assert_eq!(zotero_server_backoff_ms(Some("0"), Some("5")), None);
        assert_eq!(zotero_server_backoff_ms(Some("abc"), Some("5")), None);
        assert_eq!(zotero_server_backoff_ms(None, None), None);
    }

    #[test]
    fn attempt_backoff_grows_by_a_second_and_clamps() {
        assert_eq!(zotero_attempt_backoff_ms(0), 1000.0);
        assert_eq!(zotero_attempt_backoff_ms(1), 2000.0);
        assert_eq!(zotero_attempt_backoff_ms(5), 30_000.0);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn probe(item_type: Value, parent_item: Value) -> ZoteroChildProbe {
        ZoteroChildProbe {
            item_type,
            parent_item,
        }
    }

    #[test]
    fn child_items_by_type_or_parent() {
        assert!(is_child_item(&probe(json!("attachment"), Value::Null)));
        assert!(is_child_item(&probe(json!("note"), Value::Null)));
        assert!(is_child_item(&probe(
            json!("journalArticle"),
            json!("ABCD1234")
        )));
        assert!(!is_child_item(&probe(json!("journalArticle"), Value::Null)));
        assert!(!is_child_item(&probe(
            json!("journalArticle"),
            json!(false)
        )));
        assert!(!is_child_item(&probe(json!("journalArticle"), json!(""))));
        assert!(!is_child_item(&probe(Value::Null, Value::Null)));
    }

    #[test]
    fn library_normalizes_bare_ids_and_paths() {
        assert_eq!(
            normalize_zotero_library(Some("123456")).as_deref(),
            Some("users/123456")
        );
        assert_eq!(
            normalize_zotero_library(Some("  42 \n")).as_deref(),
            Some("users/42")
        );
        assert_eq!(
            normalize_zotero_library(Some("users/1")).as_deref(),
            Some("users/1")
        );
        assert_eq!(
            normalize_zotero_library(Some(" groups/77 ")).as_deref(),
            Some("groups/77")
        );
    }

    #[test]
    fn library_refuses_other_forms() {
        for bad in [
            None,
            Some(""),
            Some("   "),
            Some("/users/1"),
            Some("users/abc"),
            Some("Users/1"),
            Some("users/1/items"),
            Some("groups/"),
            Some("12a"),
        ] {
            assert_eq!(normalize_zotero_library(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn library_url_drops_one_slash_each_side() {
        assert_eq!(
            zotero_library_url("users/1", "https://api.zotero.org"),
            "https://api.zotero.org/users/1"
        );
        assert_eq!(
            zotero_library_url("/groups/2", "https://s.test/"),
            "https://s.test/groups/2"
        );
    }

    #[test]
    fn headers_carry_key_and_api_version() {
        let headers = zotero_headers("KEY123");
        assert_eq!(headers.len(), 2);
        assert_eq!(
            headers.get("Zotero-API-Key").map(String::as_str),
            Some("KEY123")
        );
        assert_eq!(
            headers.get("Zotero-API-Version").map(String::as_str),
            Some("3")
        );
    }

    #[test]
    fn top_level_path_names_collection_when_given() {
        assert_eq!(zotero_top_level_path(None), "/items/top");
        assert_eq!(zotero_top_level_path(Some("")), "/items/top");
        assert_eq!(
            zotero_top_level_path(Some("ABCD1234")),
            "/collections/ABCD1234/items/top"
        );
        assert_eq!(
            zotero_top_level_path(Some("a b/c")),
            "/collections/a%20b%2Fc/items/top"
        );
    }
}
