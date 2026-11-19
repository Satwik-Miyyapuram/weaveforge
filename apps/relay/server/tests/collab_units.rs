#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    missing_docs,
    unused_results
)]

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

use wf_relay_server::collab::Permission;
use wf_relay_server::collab::lease::{LeaseBook, LeaseReply};
use wf_relay_server::collab::protocol::{
    Control, Incoming, classify, hello_json, lease_reply_json, parse_control, sync_step1,
    token_from_protocols, update_frame,
};
use wf_relay_server::collab::update_log::{UpdateLog, list_logs, log_path};
use yrs::sync::Message;
use yrs::updates::encoder::Encode;
use yrs::{Doc, ReadTxn, StateVector, Text, Transact};

fn temp_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("wf-l8-{}-{}", name, std::process::id()))
}

#[test]
fn lease_acquire_denied_while_held() {
    let mut book = LeaseBook::new(90_000);
    assert_eq!(
        book.acquire("A", "u1", 0),
        LeaseReply::Granted { until_ms: 90_000 }
    );
    assert_eq!(
        book.acquire("B", "u2", 1_000),
        LeaseReply::Denied {
            holder: "A".to_owned(),
            until_ms: 90_000
        }
    );
    assert_eq!(
        book.acquire("A", "u1", 2_000),
        LeaseReply::Granted { until_ms: 92_000 }
    );
}

#[test]
fn lease_renew_rejected_from_non_holder() {
    let mut book = LeaseBook::new(90_000);
    assert_eq!(
        book.acquire("A", "u1", 0),
        LeaseReply::Granted { until_ms: 90_000 }
    );
    assert_eq!(book.renew("B", 1_000), LeaseReply::Lost);
    assert_eq!(
        book.live_holder(1_000).map(|l| l.device.as_str()),
        Some("A")
    );
    assert_eq!(
        book.renew("A", 50_000),
        LeaseReply::Granted { until_ms: 140_000 }
    );
}

#[test]
fn lease_lapse_stops_writer() {
    let mut book = LeaseBook::new(90_000);
    assert_eq!(
        book.acquire("A", "u1", 0),
        LeaseReply::Granted { until_ms: 90_000 }
    );
    assert_eq!(book.renew("A", 90_000), LeaseReply::Lost);
    assert!(book.live_holder(90_000).is_none());
    assert_eq!(
        book.acquire("B", "u2", 90_000),
        LeaseReply::Granted { until_ms: 180_000 }
    );
}

#[test]
fn lease_release_only_by_holder() {
    let mut book = LeaseBook::new(90_000);
    assert_eq!(
        book.acquire("A", "u1", 0),
        LeaseReply::Granted { until_ms: 90_000 }
    );
    assert!(!book.release("B"));
    assert_eq!(
        book.live_holder(1_000).map(|l| l.device.as_str()),
        Some("A")
    );
    assert!(book.release("A"));
    assert!(book.live_holder(1_000).is_none());
    assert!(!book.release("A"));
}

#[test]
fn update_log_round_trip() {
    let dir = temp_dir("round-trip");
    let mut log = UpdateLog::open(&dir, "doc/1").unwrap();
    log.append(b"one").unwrap();
    log.append(b"two").unwrap();
    log.append(b"three").unwrap();
    drop(log);

    let reopened = UpdateLog::open(&dir, "doc/1").unwrap();
    assert_eq!(
        reopened.read_all().unwrap(),
        vec![b"one".to_vec(), b"two".to_vec(), b"three".to_vec()]
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn update_log_torn_tail_ignored() {
    let dir = temp_dir("torn-tail");
    let mut log = UpdateLog::open(&dir, "doc/1").unwrap();
    log.append(b"first").unwrap();
    log.append(b"second").unwrap();

    // A length prefix of 5 with only one byte of body: a crash mid-write.
    let mut raw = OpenOptions::new()
        .append(true)
        .open(log_path(&dir, "doc/1"))
        .unwrap();
    raw.write_all(&[5, 0, 0, 0, 1]).unwrap();
    drop(raw);

    assert_eq!(
        log.read_all().unwrap(),
        vec![b"first".to_vec(), b"second".to_vec()]
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn update_log_truncate_and_list() {
    let dir = temp_dir("truncate-list");
    let mut log = UpdateLog::open(&dir, "doc/1:é").unwrap();
    log.append(b"x").unwrap();
    assert_eq!(list_logs(&dir).unwrap(), vec!["doc/1:é".to_owned()]);

    log.truncate().unwrap();
    assert!(log.read_all().unwrap().is_empty());

    log.remove().unwrap();
    assert!(list_logs(&dir).unwrap().is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn list_logs_missing_dir_is_empty() {
    let dir = temp_dir("missing-dir");
    let _ = std::fs::remove_dir_all(&dir);
    assert!(list_logs(&dir).unwrap().is_empty());
}

#[test]
fn token_from_protocols_cases() {
    assert_eq!(token_from_protocols("wf.v1, abc"), Some("abc"));
    assert_eq!(token_from_protocols("wf.v1,abc"), Some("abc"));
    assert_eq!(token_from_protocols("other, abc"), None);
    assert_eq!(token_from_protocols("wf.v1"), None);
    assert_eq!(token_from_protocols("wf.v1, "), None);
}

#[test]
fn parse_control_cases() {
    assert_eq!(
        parse_control(r#"{"type":"lease.acquire","device":"d1"}"#),
        Some(Control::Acquire {
            device: "d1".to_owned()
        })
    );
    assert_eq!(
        parse_control(r#"{"type":"lease.renew","device":"d1"}"#),
        Some(Control::Renew {
            device: "d1".to_owned()
        })
    );
    assert_eq!(
        parse_control(r#"{"type":"lease.release","device":"d1"}"#),
        Some(Control::Release {
            device: "d1".to_owned()
        })
    );
    assert_eq!(
        parse_control(r#"{"type":"lease.final","device":"d1"}"#),
        Some(Control::Final {
            device: "d1".to_owned()
        })
    );
    assert_eq!(parse_control(r#"{"type":"lease.acquire"}"#), None);
    assert_eq!(
        parse_control(r#"{"type":"lease.acquire","device":""}"#),
        None
    );
    assert_eq!(
        parse_control(r#"{"type":"lease.bogus","device":"d1"}"#),
        None
    );
    assert_eq!(parse_control("not json"), None);
}

#[test]
fn lease_and_hello_json_shapes() {
    let granted = lease_reply_json(&LeaseReply::Granted { until_ms: 5 });
    let granted: serde_json::Value = serde_json::from_str(&granted).unwrap();
    assert_eq!(
        granted,
        serde_json::json!({"type": "lease.granted", "until": 5})
    );

    let denied = lease_reply_json(&LeaseReply::Denied {
        holder: "A".to_owned(),
        until_ms: 9,
    });
    let denied: serde_json::Value = serde_json::from_str(&denied).unwrap();
    assert_eq!(
        denied,
        serde_json::json!({"type": "lease.denied", "holder": "A", "until": 9})
    );

    let hello = hello_json(3, 1, Permission::Edit, false);
    let hello: serde_json::Value = serde_json::from_str(&hello).unwrap();
    assert_eq!(
        hello,
        serde_json::json!({
            "type": "hello",
            "epoch": 3,
            "format_version": 1,
            "permission": "edit",
            "read_only": false
        })
    );
}

#[test]
fn classify_sync_frames() {
    let doc = Doc::new();
    let text = doc.get_or_insert_text("t");
    {
        let mut txn = doc.transact_mut();
        text.insert(&mut txn, 0, "hi");
    }
    let update = doc
        .transact()
        .encode_state_as_update_v1(&StateVector::default());

    let frame = update_frame(update.clone());
    assert!(matches!(
        classify(&frame),
        Some(Incoming::Update(u)) if u == update
    ));

    let sv = doc.transact().state_vector();
    assert!(matches!(
        classify(&sync_step1(&sv)),
        Some(Incoming::SyncStep1(_))
    ));

    assert!(classify(&[255]).is_none());

    let awareness_query = Message::AwarenessQuery.encode_v1();
    assert!(matches!(classify(&awareness_query), Some(Incoming::Relay)));
}
