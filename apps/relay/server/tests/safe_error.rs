#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

//! Wording the SDK caller sees for database errors.

use wf_relay_server::postgrest::DbError;
use wf_relay_server::safe_error::{
    SERVER_FAULT, database_code, format_error_for_response, log_line, transport_log_line,
};

const MIGRATION_HINT: &str = "The server is missing a database migration; apply the schema migrations (npm run migrate:schema) and try again.";

fn db(code: Option<&str>) -> DbError {
    DbError {
        code: code.map(str::to_string),
        message: "secret table users_x".to_string(),
    }
}

#[test]
fn database_code_keeps_sqlstate_and_postgrest_codes() {
    assert_eq!(database_code(Some("23505")), Some("23505".to_string()));
    assert_eq!(database_code(Some(" 42P01 ")), Some("42P01".to_string()));
    assert_eq!(
        database_code(Some("PGRST205")),
        Some("PGRST205".to_string())
    );
    assert_eq!(
        database_code(Some("PGRST116")),
        Some("PGRST116".to_string())
    );
    assert_eq!(database_code(Some("40001")), Some("40001".to_string()));
}

#[test]
fn database_code_rejects_empty_and_non_sqlstate() {
    assert_eq!(database_code(None), None);
    assert_eq!(database_code(Some("")), None);
    assert_eq!(database_code(Some("   ")), None);
    assert_eq!(database_code(Some("EPERM")), None);
    assert_eq!(database_code(Some("2350")), None);
    assert_eq!(database_code(Some("ZZ000")), None);
}

#[test]
fn caller_fault_codes_get_their_own_wording() {
    let unique = db(Some("23505"));
    assert_eq!(
        format_error_for_response(&unique, "t"),
        "That value is already in use. (23505)"
    );
    let rls = db(Some("42501"));
    assert_eq!(
        format_error_for_response(&rls, "t"),
        "You do not have permission to do that. (42501)"
    );
}

#[test]
fn missing_migration_codes_get_the_hint() {
    let spaced = db(Some(" 42P01 "));
    assert_eq!(
        format_error_for_response(&spaced, "t"),
        format!("{MIGRATION_HINT} (42P01)")
    );
    let schema_cache = db(Some("PGRST205"));
    assert_eq!(
        format_error_for_response(&schema_cache, "t"),
        format!("{MIGRATION_HINT} (PGRST205)")
    );
}

#[test]
fn other_database_codes_get_server_fault_with_code() {
    let postgrest = db(Some("PGRST116"));
    assert_eq!(
        format_error_for_response(&postgrest, "t"),
        "Something went wrong on the server. (PGRST116)"
    );
    let serialization = db(Some("40001"));
    assert_eq!(
        format_error_for_response(&serialization, "t"),
        "Something went wrong on the server. (40001)"
    );
}

#[test]
fn non_database_codes_get_bare_server_fault() {
    assert_eq!(
        format_error_for_response(&db(Some("EPERM")), "t"),
        SERVER_FAULT
    );
    assert_eq!(format_error_for_response(&db(None), "t"), SERVER_FAULT);
}

#[test]
fn message_text_never_reaches_the_output() {
    for err in [db(Some("23505")), db(Some("EPERM")), db(None)] {
        let out = format_error_for_response(&err, "t");
        assert!(!out.contains("secret"));
        assert!(!out.contains("users_x"));
    }
}

#[test]
fn the_log_line_names_the_code_and_never_the_message() {
    // A message can echo request values (a reqwest error names the URL, query filters
    // included), so the log carries the context and a recognised code only.
    assert_eq!(
        log_line(&db(Some(" 23505 ")), "t"),
        "[t] database error 23505"
    );
    assert_eq!(
        log_line(&db(Some("PGRST205")), "t"),
        "[t] database error PGRST205"
    );
    assert_eq!(log_line(&db(None), "t"), "[t] database error (no code)");
    assert_eq!(
        log_line(&db(Some("  ")), "t"),
        "[t] database error (no code)"
    );
    // An unrecognised code is free text too: it is not logged.
    assert_eq!(
        log_line(&db(Some("eq.secret-key")), "t"),
        "[t] database error (unrecognised code)"
    );
    for err in [db(Some("23505")), db(Some("eq.secret-key")), db(None)] {
        let line = log_line(&err, "t");
        assert!(!line.contains("secret"));
        assert!(!line.contains("users_x"));
    }
}

#[test]
fn database_code_rejects_free_text_shaped_like_a_code() {
    for code in [
        "23abc",
        "23ab!",
        "42p01",
        "23 05",
        "PGRST",
        "PGRST1",
        "PGRST1234",
        "PGRSTeq.x",
        "pgrst116",
    ] {
        assert_eq!(database_code(Some(code)), None, "{code}");
    }
    assert_eq!(
        log_line(&db(Some("PGRSTeq.secret")), "t"),
        "[t] database error (unrecognised code)"
    );
    assert_eq!(
        format_error_for_response(&db(Some("23key")), "t"),
        SERVER_FAULT
    );
}

/// A reqwest error for a request whose URL carries a key in its path and query.
async fn transport_error_for(url: &str) -> reqwest::Error {
    reqwest::Client::new().get(url).send().await.unwrap_err()
}

#[tokio::test]
async fn the_transport_log_line_names_the_kind_and_never_the_url() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let err = transport_error_for(&format!(
        "http://127.0.0.1:{port}/secret-path?key=eq.secret-key"
    ))
    .await;
    let line = transport_log_line(&err, "t");
    assert_eq!(line, "[t] request failed: connect");
    assert!(
        !line.contains("secret") && !line.contains("127.0.0.1"),
        "{line}"
    );
}

#[tokio::test]
async fn the_transport_log_line_hides_a_malformed_url() {
    let err = transport_error_for("http://[secret-key/").await;
    let line = transport_log_line(&err, "t");
    assert_eq!(line, "[t] request failed: builder");
    assert!(!line.contains("secret"), "{line}");
}
