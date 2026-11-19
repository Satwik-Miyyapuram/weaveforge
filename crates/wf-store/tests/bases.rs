//! Integration tests for `wf_store::bases`: round trip, on-disk persistence, replace and remove.

#[cfg(test)]
mod common;

use common::TempDir;
use wf_core::sync::frontmatter::canonical_digest;
use wf_store::bases::BaseStore;

#[test]
fn base_store_round_trip() {
    let store = BaseStore::open_in_memory().unwrap();
    let digest = store
        .set("item-1", "a\r\nb", Some(&[1u8, 2, 3][..]))
        .unwrap();
    let base = store.get("item-1").unwrap().unwrap();
    assert_eq!(base.text, "a\nb");
    assert_eq!(base.digest, digest);
    assert_eq!(digest, canonical_digest("a\nb"));
    assert_eq!(base.yjs_state, Some(vec![1, 2, 3]));
}

#[test]
fn base_store_persists_on_disk() {
    let dir = TempDir::new();
    {
        let store = BaseStore::open(dir.path()).unwrap();
        let _ = store.set("item-1", "hello", None).unwrap();
    }
    let store = BaseStore::open(dir.path()).unwrap();
    let base = store.get("item-1").unwrap().unwrap();
    assert_eq!(base.text, "hello");
    assert_eq!(base.yjs_state, None);
}

#[test]
fn base_store_keeps_yjs_state_when_text_unchanged() {
    let store = BaseStore::open_in_memory().unwrap();
    let _ = store.set("item-1", "first", Some(&[7u8][..])).unwrap();
    let _ = store.set("item-1", "first", None).unwrap();
    let base = store.get("item-1").unwrap().unwrap();
    assert_eq!(base.yjs_state, Some(vec![7u8]));
}

#[test]
fn base_store_drops_stale_yjs_state_when_text_changes() {
    let store = BaseStore::open_in_memory().unwrap();
    let _ = store.set("item-1", "first", Some(&[7u8][..])).unwrap();
    let _ = store.set("item-1", "second", None).unwrap();
    let base = store.get("item-1").unwrap().unwrap();
    assert_eq!(base.text, "second");
    assert_eq!(base.yjs_state, None);
}

#[test]
fn base_store_replaces_and_removes() {
    let store = BaseStore::open_in_memory().unwrap();
    let _ = store.set("item-1", "first", None).unwrap();
    let _ = store.set("item-1", "second", Some(&[9u8][..])).unwrap();
    assert_eq!(store.get("item-1").unwrap().unwrap().text, "second");
    assert!(store.remove("item-1").unwrap());
    assert!(!store.remove("item-1").unwrap());
    assert_eq!(store.get("item-1").unwrap(), None);
}
