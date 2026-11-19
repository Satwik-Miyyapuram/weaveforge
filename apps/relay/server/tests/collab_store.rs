#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    missing_docs,
    unused_results
)]

mod common;

use common::{response, serve};
use wf_relay_server::collab::Permission;
use wf_relay_server::collab::store::{
    DocRow, DocStatus, MemoryStore, NewGrant, PgStore, SharedDocStore, bytea_from_hex, bytea_hex,
};

fn doc_row(item_id: &str, owner: &str, state: Vec<u8>) -> DocRow {
    DocRow {
        item_id: item_id.to_owned(),
        owner: owner.to_owned(),
        kind: "canvas".to_owned(),
        project_id: None,
        workspace_id: None,
        epoch: 1,
        format_version: 1,
        state,
        status: DocStatus::Open,
    }
}

fn grant(
    owner: &str,
    scope: &str,
    target: &str,
    grantee: &str,
    permission: Permission,
) -> NewGrant {
    NewGrant {
        owner: owner.to_owned(),
        scope: scope.to_owned(),
        target_id: target.to_owned(),
        grantee_user: grantee.to_owned(),
        permission,
        expires_at: None,
    }
}

#[tokio::test]
async fn seed_insert_conflict_ignored() {
    let store = MemoryStore::new();
    let first = doc_row("item-1", "u1", vec![1]);
    let second = doc_row("item-1", "u2", vec![2]);
    store.seed(&first).await.unwrap();
    store.seed(&second).await.unwrap();
    assert_eq!(store.doc("item-1"), Some(doc_row("item-1", "u1", vec![1])));
}

#[tokio::test]
async fn memory_access_rules() {
    let store = MemoryStore::new();
    let mut row = doc_row("item-1", "owner-1", vec![]);
    row.project_id = Some("proj-1".to_owned());
    store.seed(&row).await.unwrap();

    // The owner has everything.
    assert_eq!(
        store.access("item-1", "owner-1").await.unwrap(),
        Some(Permission::Owner)
    );

    // An item grant to edit.
    let item_grant = store
        .create_grant(&grant(
            "owner-1",
            "item",
            "item-1",
            "u-edit",
            Permission::Edit,
        ))
        .await
        .unwrap();
    assert_eq!(
        store.access("item-1", "u-edit").await.unwrap(),
        Some(Permission::Edit)
    );

    // A project grant to view reaches the item through its project_id.
    store
        .create_grant(&grant(
            "owner-1",
            "project",
            "proj-1",
            "u-view",
            Permission::View,
        ))
        .await
        .unwrap();
    assert_eq!(
        store.access("item-1", "u-view").await.unwrap(),
        Some(Permission::View)
    );

    // A revoked grant gives nothing.
    let revoked = store.revoke_grant("owner-1", &item_grant.id).await.unwrap();
    assert_eq!(revoked, Some("item-1".to_owned()));
    assert_eq!(store.access("item-1", "u-edit").await.unwrap(), None);

    // A grant created by someone who is not the owner gives nothing.
    store
        .create_grant(&grant("u-other", "item", "item-1", "u-x", Permission::Edit))
        .await
        .unwrap();
    assert_eq!(store.access("item-1", "u-x").await.unwrap(), None);

    // With view and edit both live, the stronger one wins.
    store
        .create_grant(&grant(
            "owner-1",
            "item",
            "item-1",
            "u-both",
            Permission::View,
        ))
        .await
        .unwrap();
    store
        .create_grant(&grant(
            "owner-1",
            "project",
            "proj-1",
            "u-both",
            Permission::Edit,
        ))
        .await
        .unwrap();
    assert_eq!(
        store.access("item-1", "u-both").await.unwrap(),
        Some(Permission::Edit)
    );
}

#[tokio::test]
async fn memory_save_state_needs_matching_epoch() {
    let store = MemoryStore::new();
    store.seed(&doc_row("item-1", "u1", vec![1])).await.unwrap();

    // Wrong epoch (row is at 1): nothing written.
    store.save_state("item-1", 2, &[9]).await.unwrap();
    assert_eq!(store.doc("item-1").unwrap().state, vec![1]);

    // Matching epoch: written and counted.
    store.save_state("item-1", 1, &[9]).await.unwrap();
    assert_eq!(store.doc("item-1").unwrap().state, vec![9]);
    assert_eq!(store.saves(), 1);
}

#[tokio::test]
async fn memory_replace_state_bumps_epoch() {
    let store = MemoryStore::new();
    store.seed(&doc_row("item-1", "u1", vec![1])).await.unwrap();

    let epoch = store.replace_state("item-1", "feed", &[7]).await.unwrap();
    assert_eq!(epoch, 2);
    let row = store.doc("item-1").unwrap();
    assert_eq!(row.epoch, 2);
    assert_eq!(row.kind, "feed");
    assert_eq!(row.state, vec![7]);

    // No row: an error.
    assert!(store.replace_state("missing", "feed", &[7]).await.is_err());
}

#[test]
fn bytea_hex_round_trip() {
    assert_eq!(bytea_hex(&[1, 2, 255]), "\\x0102ff");
    assert_eq!(bytea_from_hex("\\x0102ff"), Some(vec![1, 2, 255]));
    assert_eq!(bytea_from_hex(&bytea_hex(&[])), Some(vec![]));
    assert_eq!(bytea_from_hex("\\x0"), None);
    assert_eq!(bytea_from_hex("\\xzz"), None);
    assert_eq!(bytea_from_hex("12"), None);
}

#[tokio::test]
async fn pg_load_parses_row() {
    let body = br#"[{"item_id":"item-1","owner":"u1","kind":"canvas","project_id":"p1","workspace_id":null,"epoch":3,"format_version":1,"state":"\\x0102","status":"closing"}]"#;
    let up = serve(vec![(
        "/rest/v1/shared_docs",
        vec![response(200, &[], body)],
    )])
    .await;
    let client = reqwest::Client::new();
    let data_url = format!("http://127.0.0.1:{}/rest/v1", up.port);
    let store = PgStore::new(client, data_url, "svc".to_owned());

    let row = store.load("item-1").await.unwrap().unwrap();
    assert_eq!(row.item_id, "item-1");
    assert_eq!(row.owner, "u1");
    assert_eq!(row.kind, "canvas");
    assert_eq!(row.project_id, Some("p1".to_owned()));
    assert_eq!(row.workspace_id, None);
    assert_eq!(row.epoch, 3);
    assert_eq!(row.format_version, 1);
    assert_eq!(row.state, vec![1, 2]);
    assert_eq!(row.status, DocStatus::Closing);
}

#[tokio::test]
async fn pg_seed_ignores_duplicates() {
    let up = serve(vec![(
        "/rest/v1/shared_docs",
        vec![response(201, &[], b"")],
    )])
    .await;
    let client = reqwest::Client::new();
    let data_url = format!("http://127.0.0.1:{}/rest/v1", up.port);
    let store = PgStore::new(client, data_url, "svc".to_owned());

    store.seed(&doc_row("item-1", "u1", vec![1])).await.unwrap();

    let seen = up.seen();
    let request = &seen[0];
    assert!(request.target.contains("on_conflict=item_id"));
    assert!(
        request
            .header("prefer")
            .unwrap()
            .contains("resolution=ignore-duplicates")
    );
}

#[tokio::test]
async fn pg_access_calls_rpc() {
    let up = serve(vec![(
        "/rest/v1/rpc/shared_doc_access",
        vec![
            response(200, &[], br#""edit""#),
            response(200, &[], b"null"),
        ],
    )])
    .await;
    let client = reqwest::Client::new();
    let data_url = format!("http://127.0.0.1:{}/rest/v1", up.port);
    let store = PgStore::new(client, data_url, "svc".to_owned());

    assert_eq!(
        store.access("item-1", "u-edit").await.unwrap(),
        Some(Permission::Edit)
    );
    assert_eq!(store.access("item-1", "u-none").await.unwrap(), None);
}

#[tokio::test]
async fn pg_save_state_filters_epoch() {
    let up = serve(vec![(
        "/rest/v1/shared_docs",
        vec![response(204, &[], b"")],
    )])
    .await;
    let client = reqwest::Client::new();
    let data_url = format!("http://127.0.0.1:{}/rest/v1", up.port);
    let store = PgStore::new(client, data_url, "svc".to_owned());

    store.save_state("item-1", 4, &[1]).await.unwrap();

    let seen = up.seen();
    assert!(seen[0].target.contains("epoch=eq.4"));
}
