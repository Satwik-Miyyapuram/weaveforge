//! Zotero annotation write-back: the request headers and the per-annotation outcome of each reply.
//! Ports the pure parts of `ZoteroApiAnnotationWriteBack` in
//! apps/web/src/features/reader/infrastructure/parts-2.ts. The fetch calls, the response body
//! read and the write token stay in TS.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::overleaf_workshop::encode_uri_component;
use crate::papers::zotero_library::zotero_headers;

/// Reason given when Zotero answers 412 to an update: the item moved on since the last sync.
pub const CHANGED_IN_ZOTERO_REASON: &str =
    "The annotation changed in Zotero since this copy was synced.";

/// Reason given when a created annotation has no key in Zotero's reply.
pub const NOT_REPORTED_REASON: &str = "Zotero did not report this annotation as written.";

/// What became of one annotation in a write-back run (TS `ZoteroAnnotationWriteResult.outcome`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WriteOutcome {
    Created,
    Updated,
    Conflict,
    Failed,
}

/// One annotation's result (TS `ZoteroAnnotationWriteResult`). Absent fields are omitted, as the
/// TS object omits them.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteBackResult {
    pub id: String,
    pub outcome: WriteOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zotero_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zotero_version: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// The body of a Zotero multi-write reply (TS `ZoteroWriteResponse`), keyed by the item's index
/// in the request.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReply {
    pub successful: Option<BTreeMap<String, CreatedEntry>>,
    pub failed: Option<BTreeMap<String, FailedEntry>>,
}

/// An item Zotero created: its key and the library version after the write.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct CreatedEntry {
    pub key: Option<String>,
    pub version: Option<f64>,
}

/// An item Zotero rejected, with its message.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct FailedEntry {
    pub message: Option<String>,
}

fn is_success(status: u16) -> bool {
    (200..300).contains(&status)
}

/// The `Last-Modified-Version` header as a library version (TS `versionHeader`). A missing or
/// non-numeric value gives `None`.
#[must_use]
pub fn library_version(raw: Option<&str>) -> Option<f64> {
    let raw = raw.filter(|text| !text.is_empty())?;
    raw.parse::<f64>().ok().filter(|n| n.is_finite())
}

/// The headers of an update (PATCH): JSON content type, the Zotero API headers, and the
/// `If-Unmodified-Since-Version` guard when the annotation has a known version.
#[must_use]
pub fn update_headers(api_key: &str, zotero_version: Option<f64>) -> BTreeMap<String, String> {
    let mut headers = BTreeMap::from([("Content-Type".to_owned(), "application/json".to_owned())]);
    headers.extend(zotero_headers(api_key));
    if let Some(version) = zotero_version {
        headers.insert(
            "If-Unmodified-Since-Version".to_owned(),
            format!("{version}"),
        );
    }
    headers
}

/// The URL of one existing item, `<base>/items/<key>`, with the key percent-encoded.
#[must_use]
pub fn update_url(base: &str, zotero_key: &str) -> String {
    format!("{base}/items/{}", encode_uri_component(zotero_key))
}

/// The outcome of a PATCH of one annotation. A 412 is a conflict, never an overwrite; any other
/// non-success is a failure carrying the response detail.
#[must_use]
pub fn update_outcome(
    id: &str,
    zotero_key: &str,
    status: u16,
    detail: &str,
    library_version: Option<f64>,
) -> WriteBackResult {
    if status == 412 {
        return WriteBackResult {
            id: id.to_owned(),
            outcome: WriteOutcome::Conflict,
            zotero_key: Some(zotero_key.to_owned()),
            zotero_version: None,
            reason: Some(CHANGED_IN_ZOTERO_REASON.to_owned()),
        };
    }
    if !is_success(status) {
        return WriteBackResult {
            id: id.to_owned(),
            outcome: WriteOutcome::Failed,
            zotero_key: Some(zotero_key.to_owned()),
            zotero_version: None,
            reason: Some(format!("Zotero update failed ({status}). {detail}").trim().to_owned()),
        };
    }
    WriteBackResult {
        id: id.to_owned(),
        outcome: WriteOutcome::Updated,
        zotero_key: Some(zotero_key.to_owned()),
        zotero_version: library_version.filter(|version| *version != 0.0),
        reason: None,
    }
}

/// The outcomes of a batch create (POST of many items). A non-success status fails every item
/// with the same reason. Otherwise each item is matched to the reply by its index: created when
/// Zotero gave it a key, failed with Zotero's message or a default otherwise.
#[must_use]
pub fn create_outcomes(
    ids: &[String],
    status: u16,
    detail: &str,
    reply: &CreateReply,
    library_version: Option<f64>,
) -> Vec<WriteBackResult> {
    if !is_success(status) {
        let reason = format!("Zotero create failed ({status}). {detail}").trim().to_owned();
        return ids
            .iter()
            .map(|id| failed_result(id, reason.clone()))
            .collect();
    }
    ids.iter()
        .enumerate()
        .map(|(index, id)| {
            let key = index.to_string();
            let created = reply
                .successful
                .as_ref()
                .and_then(|map| map.get(&key))
                .and_then(|entry| entry.key.as_deref().filter(|k| !k.is_empty()).map(|k| (k, entry)));
            if let Some((zotero_key, entry)) = created {
                return WriteBackResult {
                    id: id.clone(),
                    outcome: WriteOutcome::Created,
                    zotero_key: Some(zotero_key.to_owned()),
                    zotero_version: entry
                        .version
                        .or(library_version)
                        .filter(|version| *version != 0.0),
                    reason: None,
                };
            }
            let message = reply
                .failed
                .as_ref()
                .and_then(|map| map.get(&key))
                .and_then(|entry| entry.message.clone())
                .unwrap_or_else(|| NOT_REPORTED_REASON.to_owned());
            failed_result(id, message)
        })
        .collect()
}

fn failed_result(id: &str, reason: String) -> WriteBackResult {
    WriteBackResult {
        id: id.to_owned(),
        outcome: WriteOutcome::Failed,
        zotero_key: None,
        zotero_version: None,
        reason: Some(reason),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    #[test]
    fn library_version_reads_a_numeric_header_only() {
        assert_eq!(library_version(Some("55")), Some(55.0));
        assert_eq!(library_version(Some("")), None);
        assert_eq!(library_version(Some("soon")), None);
        assert_eq!(library_version(None), None);
    }

    #[test]
    fn update_headers_guard_only_a_known_version() {
        let guarded = update_headers("key-123", Some(87.0));
        assert_eq!(guarded.get("If-Unmodified-Since-Version").map(String::as_str), Some("87"));
        assert_eq!(guarded.get("Content-Type").map(String::as_str), Some("application/json"));
        assert_eq!(guarded.get("Zotero-API-Key").map(String::as_str), Some("key-123"));
        assert!(!update_headers("key-123", None).contains_key("If-Unmodified-Since-Version"));
    }

    #[test]
    fn update_url_encodes_the_key() {
        assert_eq!(
            update_url("https://api.zotero.org/users/42", "ZKEY01"),
            "https://api.zotero.org/users/42/items/ZKEY01"
        );
    }

    #[test]
    fn a_412_on_update_is_a_conflict_not_an_overwrite() {
        let out = update_outcome("a", "ZKEY01", 412, "", Some(9.0));
        assert_eq!(out.outcome, WriteOutcome::Conflict);
        assert_eq!(out.reason.as_deref(), Some(CHANGED_IN_ZOTERO_REASON));
        assert_eq!(out.zotero_version, None);
    }

    #[test]
    fn an_update_that_succeeds_carries_the_new_version() {
        let out = update_outcome("a", "ZKEY01", 204, "", Some(88.0));
        assert_eq!(out.outcome, WriteOutcome::Updated);
        assert_eq!(out.zotero_version, Some(88.0));
        assert_eq!(out.reason, None);
    }

    #[test]
    fn a_failed_update_says_the_status_and_the_detail() {
        let out = update_outcome("a", "ZKEY01", 500, "  upstream boom ", None);
        assert_eq!(out.outcome, WriteOutcome::Failed);
        assert_eq!(
            out.reason.as_deref(),
            Some("Zotero update failed (500). upstream boom")
        );
    }

    #[test]
    fn a_failed_create_fails_every_item_with_one_reason() {
        let out = create_outcomes(&ids(&["a", "b"]), 500, "down", &CreateReply::default(), None);
        assert_eq!(out.len(), 2);
        assert!(out.iter().all(|r| r.outcome == WriteOutcome::Failed));
        assert_eq!(out[0].reason.as_deref(), Some("Zotero create failed (500). down"));
        assert_eq!(out[1].zotero_key, None);
    }

    #[test]
    fn a_created_item_takes_its_key_and_the_entry_or_library_version() {
        let reply = CreateReply {
            successful: Some(BTreeMap::from([(
                "0".to_owned(),
                CreatedEntry { key: Some("ZKEY01".into()), version: None },
            )])),
            failed: None,
        };
        let out = create_outcomes(&ids(&["a"]), 200, "", &reply, Some(55.0));
        assert_eq!(out[0].outcome, WriteOutcome::Created);
        assert_eq!(out[0].zotero_key.as_deref(), Some("ZKEY01"));
        assert_eq!(out[0].zotero_version, Some(55.0));
    }

    #[test]
    fn a_rejected_item_keeps_zoteros_message_or_the_default() {
        let reply = CreateReply {
            successful: None,
            failed: Some(BTreeMap::from([
                ("0".to_owned(), FailedEntry { message: Some("invalid annotationPosition".into()) }),
            ])),
        };
        let out = create_outcomes(&ids(&["a", "b"]), 200, "", &reply, None);
        assert_eq!(out[0].reason.as_deref(), Some("invalid annotationPosition"));
        assert_eq!(out[1].reason.as_deref(), Some(NOT_REPORTED_REASON));
    }
}
