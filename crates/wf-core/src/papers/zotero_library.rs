//! Zotero Web API library paths and the child-item test (TS `zotero-web-api.ts`). The fetching
//! and paging stay in TypeScript; this module holds the string rules.

use serde::Deserialize;
use serde_json::Value;

use crate::overleaf_workshop::encode_uri_component;
use crate::reader_analysis::lines::js_trim;

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
