//! SigV4 signing and the S3 object client, against the local harness server.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use common::{Upstream, response, serve};
use reqwest::Client;
use sha2::{Digest, Sha256};
use wf_relay_server::s3::{
    S3Object, S3Target, SignRequest, amz_date, authorization, delete_object, get_object,
    object_uri, put_object,
};

const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const AWS_EXPECTED: &str = "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41";

/// Signs the AWS docs GET-object example with the given header list.
fn aws_sign(headers: &[(&str, &str)]) -> String {
    authorization(&SignRequest {
        method: "GET",
        canonical_uri: "/test.txt",
        canonical_query: "",
        headers,
        payload_sha256: EMPTY_SHA256,
        amz_date: "20130524T000000Z",
        region: "us-east-1",
        access_key_id: "AKIAIOSFODNN7EXAMPLE",
        secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    })
}

/// Lower-case hex SHA-256 of `bytes`, for expected header values.
fn sha_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// A client target pointing at the harness server, bucket `phys`.
fn target(up: &Upstream) -> S3Target {
    S3Target {
        endpoint: format!("http://127.0.0.1:{}", up.port),
        region: "auto".into(),
        bucket: "phys".into(),
        access_key_id: "AK".into(),
        secret_access_key: "SK".into(),
    }
}

#[test]
fn amz_date_known_values() {
    assert_eq!(amz_date(1_369_353_600), "20130524T000000Z");
    assert_eq!(amz_date(0), "19700101T000000Z");
    assert_eq!(amz_date(951_782_400), "20000229T000000Z");
    assert_eq!(amz_date(1_767_225_599), "20251231T235959Z");
}

#[test]
fn object_uri_percent_encodes_key() {
    assert_eq!(object_uri("b", "u1/a b+c.png"), "/b/u1/a%20b%2Bc.png");
}

#[test]
fn authorization_matches_aws_get_object_example() {
    let headers = [
        ("host", "examplebucket.s3.amazonaws.com"),
        ("range", "bytes=0-9"),
        ("x-amz-content-sha256", EMPTY_SHA256),
        ("x-amz-date", "20130524T000000Z"),
    ];
    assert_eq!(aws_sign(&headers), AWS_EXPECTED);
}

#[test]
fn authorization_ignores_header_order() {
    let headers = [
        ("x-amz-date", "20130524T000000Z"),
        ("x-amz-content-sha256", EMPTY_SHA256),
        ("range", "bytes=0-9"),
        ("host", "examplebucket.s3.amazonaws.com"),
    ];
    assert_eq!(aws_sign(&headers), AWS_EXPECTED);
}

#[tokio::test]
async fn put_sends_signed_request() {
    let up = serve(vec![(
        "/phys/paper-images/u1/a.png",
        vec![response(200, &[], b"")],
    )])
    .await;
    let result = put_object(
        &Client::new(),
        &target(&up),
        "paper-images/u1/a.png",
        b"PNGDATA".to_vec(),
        "image/png",
        1_369_353_600,
    )
    .await;
    assert_eq!(result, Ok(()));

    let seen = up.seen();
    assert_eq!(seen.len(), 1);
    let req = &seen[0];
    assert_eq!(req.method, "PUT");
    assert_eq!(req.target, "/phys/paper-images/u1/a.png");
    assert_eq!(req.body, b"PNGDATA");
    assert_eq!(req.header("content-type"), Some("image/png"));
    assert_eq!(req.header("x-amz-date"), Some("20130524T000000Z"));
    assert_eq!(
        req.header("host"),
        Some(format!("127.0.0.1:{}", up.port).as_str())
    );
    assert_eq!(
        req.header("x-amz-content-sha256"),
        Some(sha_hex(b"PNGDATA").as_str())
    );
    let auth = req.header("authorization").unwrap();
    assert!(
        auth.starts_with("AWS4-HMAC-SHA256 Credential=AK/"),
        "{auth}"
    );
    assert!(
        auth.contains("SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date"),
        "{auth}"
    );
}

#[tokio::test]
async fn put_server_error_is_err() {
    let up = serve(vec![(
        "/phys/paper-images/u1/a.png",
        vec![response(500, &[], b"")],
    )])
    .await;
    let result = put_object(
        &Client::new(),
        &target(&up),
        "paper-images/u1/a.png",
        b"PNGDATA".to_vec(),
        "image/png",
        1_369_353_600,
    )
    .await;
    assert_eq!(result, Err("Object store replied 500 to PUT.".to_string()));
}

#[tokio::test]
async fn get_200_returns_bytes_and_content_type() {
    let up = serve(vec![(
        "/phys/paper-images/u1/a.png",
        vec![response(200, &[("Content-Type", "image/png")], b"PNG")],
    )])
    .await;
    let got = get_object(
        &Client::new(),
        &target(&up),
        "paper-images/u1/a.png",
        1_369_353_600,
    )
    .await;
    assert_eq!(
        got,
        Some(S3Object {
            bytes: b"PNG".to_vec(),
            content_type: "image/png".into(),
        })
    );
}

#[tokio::test]
async fn get_404_is_none() {
    let up = serve(vec![(
        "/phys/paper-images/u1/a.png",
        vec![response(404, &[], b"")],
    )])
    .await;
    let got = get_object(
        &Client::new(),
        &target(&up),
        "paper-images/u1/a.png",
        1_369_353_600,
    )
    .await;
    assert_eq!(got, None);
}

#[tokio::test]
async fn get_without_content_type_defaults_to_octet_stream() {
    let up = serve(vec![(
        "/phys/paper-images/u1/a.png",
        vec![response(200, &[], b"XY")],
    )])
    .await;
    let got = get_object(
        &Client::new(),
        &target(&up),
        "paper-images/u1/a.png",
        1_369_353_600,
    )
    .await;
    assert_eq!(
        got,
        Some(S3Object {
            bytes: b"XY".to_vec(),
            content_type: "application/octet-stream".into(),
        })
    );
}

#[tokio::test]
async fn delete_204_is_ok() {
    let up = serve(vec![(
        "/phys/paper-images/u1/a.png",
        vec![response(204, &[], b"")],
    )])
    .await;
    let result = delete_object(
        &Client::new(),
        &target(&up),
        "paper-images/u1/a.png",
        1_369_353_600,
    )
    .await;
    assert_eq!(result, Ok(()));
    assert_eq!(up.seen()[0].method, "DELETE");
}

#[tokio::test]
async fn delete_404_is_ok() {
    let up = serve(vec![(
        "/phys/paper-images/u1/a.png",
        vec![response(404, &[], b"")],
    )])
    .await;
    let result = delete_object(
        &Client::new(),
        &target(&up),
        "paper-images/u1/a.png",
        1_369_353_600,
    )
    .await;
    assert_eq!(result, Ok(()));
}

#[tokio::test]
async fn delete_500_is_err() {
    let up = serve(vec![(
        "/phys/paper-images/u1/a.png",
        vec![response(500, &[], b"")],
    )])
    .await;
    let result = delete_object(
        &Client::new(),
        &target(&up),
        "paper-images/u1/a.png",
        1_369_353_600,
    )
    .await;
    assert_eq!(
        result,
        Err("Object store replied 500 to DELETE.".to_string())
    );
}
