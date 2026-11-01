#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use common::{Reply, Upstream, response, serve};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use wf_relay_server::auth::{AuthError, mint_jwt, require_user};
use wf_relay_server::config::Config;

const USER: &str = "00000000-0000-4000-8000-000000000001";
const ANON: &str = "anon-key";
const SERVICE: &str = "service-key";
const SECRET: &str = "jwt-secret";
const API_TOKEN: &str = "tt_0123456789abcdefghijklmnop";
const SCOPES: &str = "/rest/v1/rpc/api_token_scopes";
const RESOLVE: &str = "/rest/v1/rpc/resolve_api_token";
const GET_USER: &str = "/auth/v1/user";

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

fn refused(status: u16, message: &str) -> AuthError {
    AuthError {
        status,
        message: message.to_owned(),
    }
}

fn config(up: &Upstream, jwt_secret: Option<&str>) -> Config {
    let base = format!("http://127.0.0.1:{}", up.port);
    Config {
        supabase_url: base.clone(),
        data_url: format!("{base}/rest/v1"),
        anon_key: ANON.to_owned(),
        service_role_key: SERVICE.to_owned(),
        jwt_secret: jwt_secret.map(str::to_owned),
        allowed_origins: Vec::new(),
        bind: "127.0.0.1:0".parse().expect("valid address"),
    }
}

fn hs256_b64(secret: &str, data: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("any key length");
    mac.update(data.as_bytes());
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

fn decode(part: &str) -> String {
    String::from_utf8(URL_SAFE_NO_PAD.decode(part).unwrap()).unwrap()
}

fn token_hash(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[tokio::test]
async fn missing_or_empty_header_is_not_authenticated() {
    let up = serve(vec![]).await;
    let cfg = config(&up, Some(SECRET));
    let client = reqwest::Client::new();
    for header in [None, Some(""), Some("Bearer "), Some("bearer    ")] {
        assert_eq!(
            require_user(&client, &cfg, header).await,
            Err(refused(401, "Not authenticated."))
        );
    }
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn bad_jwt_shape_is_invalid_session_without_upstream_call() {
    let up = serve(vec![]).await;
    let cfg = config(&up, Some(SECRET));
    let client = reqwest::Client::new();
    for header in [
        "Bearer abc",
        "Bearer a.b",
        "Bearer a.b.c.d",
        "Bearer a..c",
        "Bearer a.b.c!",
    ] {
        assert_eq!(
            require_user(&client, &cfg, Some(header)).await,
            Err(refused(401, "Invalid session."))
        );
    }
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn session_jwt_is_checked_with_get_user() {
    let up = serve(vec![(
        GET_USER,
        vec![json_reply(200, &format!(r#"{{"id":"{USER}"}}"#))],
    )])
    .await;
    let cfg = config(&up, Some(SECRET));
    let client = reqwest::Client::new();
    let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln";
    let header = format!("Bearer {jwt}");
    assert_eq!(
        require_user(&client, &cfg, Some(header.as_str())).await,
        Ok(USER.to_owned())
    );
    let seen = up.seen();
    assert_eq!(seen[0].method, "GET");
    assert_eq!(seen[0].target, GET_USER);
    assert_eq!(seen[0].header("apikey"), Some(ANON));
    assert_eq!(
        seen[0].header("authorization"),
        Some(format!("Bearer {jwt}").as_str())
    );
}

#[tokio::test]
async fn session_jwt_refused_by_get_user_is_invalid_session() {
    let rejected = serve(vec![(
        GET_USER,
        vec![json_reply(401, r#"{"message":"bad"}"#)],
    )])
    .await;
    let no_id = serve(vec![(GET_USER, vec![json_reply(200, "{}")])]).await;
    let client = reqwest::Client::new();
    for up in [&rejected, &no_id] {
        let cfg = config(up, Some(SECRET));
        assert_eq!(
            require_user(&client, &cfg, Some("Bearer a.b.c")).await,
            Err(refused(401, "Invalid session."))
        );
    }
}

#[tokio::test]
async fn api_token_is_exchanged_then_checked_with_get_user() {
    let up = serve(vec![
        (SCOPES, vec![json_reply(200, r#"["mcp_relay","sdk"]"#)]),
        (RESOLVE, vec![json_reply(200, &format!("\"{USER}\""))]),
        (
            GET_USER,
            vec![json_reply(200, &format!(r#"{{"id":"{USER}"}}"#))],
        ),
    ])
    .await;
    let cfg = config(&up, Some(SECRET));
    let client = reqwest::Client::new();
    let header = format!("Bearer {API_TOKEN}");
    assert_eq!(
        require_user(&client, &cfg, Some(header.as_str())).await,
        Ok(USER.to_owned())
    );

    let seen = up.seen();
    assert_eq!(seen.len(), 3);
    assert_eq!(seen[0].method, "POST");
    assert_eq!(seen[0].target, SCOPES);
    assert_eq!(seen[0].header("apikey"), Some(SERVICE));
    assert_eq!(seen[0].header("authorization"), Some("Bearer service-key"));
    assert_eq!(seen[0].header("content-type"), Some("application/json"));
    let body: serde_json::Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(
        body["p_token_hash"],
        format!("\\x{}", token_hash(API_TOKEN))
    );
    assert_eq!(seen[1].target, RESOLVE);
    assert_eq!(seen[1].body, seen[0].body);

    let minted = seen[2]
        .header("authorization")
        .unwrap()
        .trim_start_matches("Bearer ");
    let parts: Vec<&str> = minted.split('.').collect();
    assert_eq!(parts.len(), 3);
    let claims: serde_json::Value = serde_json::from_str(&decode(parts[1])).unwrap();
    assert_eq!(claims["sub"], USER);
    assert_eq!(claims["aud"], "authenticated");
    assert_eq!(claims["role"], "authenticated");
}

#[tokio::test]
async fn api_token_without_sdk_scope_is_refused_before_minting() {
    let up = serve(vec![(SCOPES, vec![json_reply(200, r#"["mcp_relay"]"#)])]).await;
    let cfg = config(&up, Some(SECRET));
    let client = reqwest::Client::new();
    let header = format!("Bearer {API_TOKEN}");
    assert_eq!(
        require_user(&client, &cfg, Some(header.as_str())).await,
        Err(refused(401, "Invalid or expired API token."))
    );
    assert_eq!(up.seen().len(), 1);
}

#[tokio::test]
async fn api_token_resolving_to_null_is_refused() {
    let up = serve(vec![
        (SCOPES, vec![json_reply(200, r#"["sdk"]"#)]),
        (RESOLVE, vec![json_reply(200, "null")]),
    ])
    .await;
    let cfg = config(&up, Some(SECRET));
    let client = reqwest::Client::new();
    let header = format!("Bearer {API_TOKEN}");
    assert_eq!(
        require_user(&client, &cfg, Some(header.as_str())).await,
        Err(refused(401, "Invalid or expired API token."))
    );
}

#[tokio::test]
async fn api_token_without_jwt_secret_is_503() {
    let up = serve(vec![(SCOPES, vec![json_reply(200, r#"["sdk"]"#)])]).await;
    let cfg = config(&up, None);
    let client = reqwest::Client::new();
    let header = format!("Bearer {API_TOKEN}");
    assert_eq!(
        require_user(&client, &cfg, Some(header.as_str())).await,
        Err(refused(
            503,
            "Server is missing SUPABASE_JWT_SECRET for API token auth."
        ))
    );
    assert_eq!(up.seen().len(), 1);
}

#[tokio::test]
async fn scopes_rpc_failure_is_500() {
    let up = serve(vec![(
        SCOPES,
        vec![response(500, &[], br#"{"message":"boom"}"#)],
    )])
    .await;
    let cfg = config(&up, Some(SECRET));
    let client = reqwest::Client::new();
    let header = format!("Bearer {API_TOKEN}");
    assert_eq!(
        require_user(&client, &cfg, Some(header.as_str())).await,
        Err(refused(500, "Something went wrong on the server."))
    );
}

#[test]
fn mint_jwt_matches_hs256_vector() {
    // jwt.io's HS256 example: the signature of this signing input under this secret.
    assert_eq!(
        hs256_b64(
            "your-256-bit-secret",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ"
        ),
        "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    );

    let jwt = mint_jwt(SECRET, USER, 1_700_000_000);
    let parts: Vec<&str> = jwt.split('.').collect();
    assert_eq!(parts.len(), 3);
    assert_eq!(parts[0], "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    assert_eq!(
        decode(parts[1]),
        format!(
            r#"{{"aud":"authenticated","exp":1700003600,"iat":1700000000,"sub":"{USER}","role":"authenticated"}}"#
        )
    );
    assert_eq!(
        parts[2],
        hs256_b64(SECRET, &format!("{}.{}", parts[0], parts[1]))
    );
}
