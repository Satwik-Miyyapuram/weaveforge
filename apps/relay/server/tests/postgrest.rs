//! The PostgREST client that runs a query as the caller, against a local stand-in.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use common::{response, serve};
use serde_json::json;
use tokio::net::TcpListener;
use wf_relay_server::postgrest::{UserDb, eq, in_list};

fn data_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/rest/v1")
}

#[tokio::test]
async fn select_sends_get_with_headers_and_returns_rows() {
    let up = serve(vec![(
        "/rest/v1/t",
        vec![response(200, &[], br#"[{"id":1,"name":"a"}]"#)],
    )])
    .await;
    let client = reqwest::Client::new();
    let url = data_url(up.port);
    let db = UserDb::new(&client, &url, "anon", "tok");
    let rows = db
        .select(
            "t",
            &[("select", "id,name".to_string()), ("name", eq("a b"))],
        )
        .await
        .unwrap();
    assert_eq!(rows, vec![json!({"id": 1, "name": "a"})]);
    let seen = up.seen();
    assert_eq!(seen[0].method, "GET");
    assert_eq!(seen[0].target, "/rest/v1/t?select=id%2Cname&name=eq.a+b");
    assert_eq!(seen[0].header("apikey"), Some("anon"));
    assert_eq!(seen[0].header("authorization"), Some("Bearer tok"));
    assert_eq!(seen[0].header("accept"), Some("application/json"));
}

#[tokio::test]
async fn select_without_query_has_no_question_mark() {
    let up = serve(vec![("/rest/v1/t", vec![response(200, &[], b"[]")])]).await;
    let client = reqwest::Client::new();
    let url = data_url(up.port);
    let db = UserDb::new(&client, &url, "anon", "tok");
    let rows = db.select("t", &[]).await.unwrap();
    assert!(rows.is_empty());
    assert_eq!(up.seen()[0].target, "/rest/v1/t");
}

#[tokio::test]
async fn select_non_array_reply_is_unexpected() {
    let up = serve(vec![("/rest/v1/t", vec![response(200, &[], b"{}")])]).await;
    let client = reqwest::Client::new();
    let url = data_url(up.port);
    let db = UserDb::new(&client, &url, "anon", "tok");
    let err = db.select("t", &[]).await.unwrap_err();
    assert_eq!(err.code, None);
    assert_eq!(err.message, "Unexpected reply from the database.");
}

#[tokio::test]
async fn insert_sends_post_with_body_prefer_and_content_type() {
    let up = serve(vec![("/rest/v1/t", vec![response(201, &[], b"")])]).await;
    let client = reqwest::Client::new();
    let url = data_url(up.port);
    let db = UserDb::new(&client, &url, "anon", "tok");
    let rows = json!([{"id": 1}, {"id": 2}]);
    db.insert("t", &rows).await.unwrap();
    let seen = up.seen();
    assert_eq!(seen[0].method, "POST");
    assert_eq!(seen[0].target, "/rest/v1/t");
    assert_eq!(seen[0].body, rows.to_string().into_bytes());
    assert_eq!(seen[0].header("prefer"), Some("return=minimal"));
    assert_eq!(seen[0].header("content-type"), Some("application/json"));
    assert_eq!(seen[0].header("apikey"), Some("anon"));
}

#[tokio::test]
async fn upsert_sends_merge_prefer_and_returns_rows() {
    let up = serve(vec![(
        "/rest/v1/t",
        vec![response(201, &[], br#"[{"id":7}]"#)],
    )])
    .await;
    let client = reqwest::Client::new();
    let url = data_url(up.port);
    let db = UserDb::new(&client, &url, "anon", "tok");
    let rows = db
        .upsert("t", &json!({"id": 7}), &[("select", "*".to_string())])
        .await
        .unwrap();
    assert_eq!(rows, vec![json!({"id": 7})]);
    let seen = up.seen();
    assert_eq!(seen[0].method, "POST");
    assert_eq!(
        seen[0].header("prefer"),
        Some("resolution=merge-duplicates,return=representation")
    );
    assert_eq!(seen[0].body, br#"{"id":7}"#.to_vec());
}

#[tokio::test]
async fn update_sends_patch() {
    let up = serve(vec![("/rest/v1/t", vec![response(204, &[], b"")])]).await;
    let client = reqwest::Client::new();
    let url = data_url(up.port);
    let db = UserDb::new(&client, &url, "anon", "tok");
    db.update("t", &[("id", eq("1"))], &json!({"status": "running"}))
        .await
        .unwrap();
    let seen = up.seen();
    assert_eq!(seen[0].method, "PATCH");
    assert_eq!(seen[0].target, "/rest/v1/t?id=eq.1");
    assert_eq!(seen[0].header("prefer"), Some("return=minimal"));
    assert_eq!(seen[0].body, br#"{"status":"running"}"#.to_vec());
}

#[tokio::test]
async fn delete_sends_delete() {
    let up = serve(vec![("/rest/v1/t", vec![response(204, &[], b"")])]).await;
    let client = reqwest::Client::new();
    let url = data_url(up.port);
    let db = UserDb::new(&client, &url, "anon", "tok");
    db.delete("t", &[("id", eq("1"))]).await.unwrap();
    let seen = up.seen();
    assert_eq!(seen[0].method, "DELETE");
    assert_eq!(seen[0].header("prefer"), Some("return=minimal"));
}

#[tokio::test]
async fn delete_counted_reads_content_range() {
    let up = serve(vec![(
        "/rest/v1/t",
        vec![response(200, &[("Content-Range", "*/3")], b"")],
    )])
    .await;
    let client = reqwest::Client::new();
    let url = data_url(up.port);
    let db = UserDb::new(&client, &url, "anon", "tok");
    let n = db.delete_counted("t", &[("id", eq("1"))]).await.unwrap();
    assert_eq!(n, 3);
    assert_eq!(up.seen()[0].method, "DELETE");
    assert_eq!(
        up.seen()[0].header("prefer"),
        Some("count=exact,return=minimal")
    );
}

#[tokio::test]
async fn delete_counted_reads_last_range_value() {
    let up = serve(vec![(
        "/rest/v1/t",
        vec![response(200, &[("Content-Range", "0-0/1")], b"")],
    )])
    .await;
    let client = reqwest::Client::new();
    let url = data_url(up.port);
    let db = UserDb::new(&client, &url, "anon", "tok");
    assert_eq!(db.delete_counted("t", &[]).await.unwrap(), 1);
}

#[tokio::test]
async fn delete_counted_missing_header_is_zero() {
    let up = serve(vec![("/rest/v1/t", vec![response(200, &[], b"")])]).await;
    let client = reqwest::Client::new();
    let url = data_url(up.port);
    let db = UserDb::new(&client, &url, "anon", "tok");
    assert_eq!(db.delete_counted("t", &[]).await.unwrap(), 0);
}

#[tokio::test]
async fn error_reply_with_json_code_keeps_code() {
    let up = serve(vec![(
        "/rest/v1/t",
        vec![response(400, &[], br#"{"code":"23505","message":"dup"}"#)],
    )])
    .await;
    let client = reqwest::Client::new();
    let url = data_url(up.port);
    let db = UserDb::new(&client, &url, "anon", "tok");
    let err = db.insert("t", &json!([])).await.unwrap_err();
    assert_eq!(err.code.as_deref(), Some("23505"));
    assert!(err.message.starts_with("HTTP 400: "));
    assert!(err.message.contains("dup"));
}

#[tokio::test]
async fn non_json_error_reply_has_no_code() {
    let up = serve(vec![("/rest/v1/t", vec![response(500, &[], b"oops")])]).await;
    let client = reqwest::Client::new();
    let url = data_url(up.port);
    let db = UserDb::new(&client, &url, "anon", "tok");
    let err = db.select("t", &[]).await.unwrap_err();
    assert_eq!(err.code, None);
    assert!(err.message.starts_with("HTTP 500"));
}

#[tokio::test]
async fn transport_error_has_no_code() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let client = reqwest::Client::new();
    let url = data_url(port);
    let db = UserDb::new(&client, &url, "anon", "tok");
    let err = db.select("t", &[]).await.unwrap_err();
    assert_eq!(err.code, None);
    assert!(!err.message.is_empty());
}

#[test]
fn eq_wraps_value() {
    assert_eq!(eq("a b"), "eq.a b");
}

#[test]
fn in_list_quotes_and_escapes_values() {
    let values = vec!["a".to_string(), "b\"c".to_string()];
    assert_eq!(in_list(&values), r#"in.("a","b\"c")"#);
    let slash = vec!["x\\y".to_string()];
    assert_eq!(in_list(&slash), r#"in.("x\\y")"#);
}
