#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use serde_json::json;
use wf_core::overleaf_workshop::{
    BODY_REQUIRED, OverleafMeta, PROJECT_ID_INVALID, ROOT_INVALID, SESSION_ID_INVALID,
    WorkshopRequest, cdn_pdf_url, encode_uri_component, parse_overleaf_meta, read_workshop_request,
    read_workshop_session_id, safe_overleaf_error,
};

const SID: &str = "1b2c3d4e-5f60-4718-9a0b-c1d2e3f4a5b6";

#[test]
fn valid_request_is_trimmed_and_copied() {
    let body = json!({"sessionId": SID, "projectId": "abc123", "rootResourcePath": "  main.tex  "});
    let req = read_workshop_request(&body).unwrap();
    assert_eq!(
        req,
        WorkshopRequest {
            session_id: SID.into(),
            project_id: "abc123".into(),
            root_resource_path: Some("main.tex".into()),
        }
    );
}

#[test]
fn uppercase_session_id_is_accepted() {
    let upper = SID.to_uppercase();
    let body = json!({"sessionId": upper, "projectId": "p1", "rootResourcePath": "a.tex"});
    assert_eq!(read_workshop_request(&body).unwrap().session_id, upper);
}

#[test]
fn array_body_falls_through_to_session_error() {
    assert_eq!(
        read_workshop_request(&json!([1, 2])).unwrap_err(),
        SESSION_ID_INVALID
    );
}

#[test]
fn null_and_string_bodies_require_json_body() {
    assert_eq!(
        read_workshop_request(&json!(null)).unwrap_err(),
        BODY_REQUIRED
    );
    assert_eq!(
        read_workshop_request(&json!("x")).unwrap_err(),
        BODY_REQUIRED
    );
}

#[test]
fn bad_project_id_is_rejected() {
    for id in [json!("a-b"), json!(""), json!(7), json!(null)] {
        let body = json!({"sessionId": SID, "projectId": id, "rootResourcePath": "a.tex"});
        assert_eq!(
            read_workshop_request(&body).unwrap_err(),
            PROJECT_ID_INVALID
        );
    }
}

#[test]
fn missing_null_or_blank_root_means_project_main_document() {
    for root in [json!("  "), json!(null)] {
        let body = json!({"sessionId": SID, "projectId": "p1", "rootResourcePath": root});
        assert_eq!(
            read_workshop_request(&body).unwrap().root_resource_path,
            None
        );
    }
    let body = json!({"sessionId": SID, "projectId": "p1"});
    assert_eq!(
        read_workshop_request(&body).unwrap().root_resource_path,
        None
    );
}

#[test]
fn non_string_root_is_rejected() {
    for root in [json!(5), json!(["a.tex"])] {
        let body = json!({"sessionId": SID, "projectId": "p1", "rootResourcePath": root});
        assert_eq!(read_workshop_request(&body).unwrap_err(), ROOT_INVALID);
    }
}

#[test]
fn bad_session_id_is_rejected() {
    for id in [json!("not-a-uuid"), json!(5), json!(format!("{SID}\n"))] {
        let body = json!({"sessionId": id, "projectId": "p1", "rootResourcePath": "a.tex"});
        assert_eq!(
            read_workshop_request(&body).unwrap_err(),
            SESSION_ID_INVALID
        );
    }
}

#[test]
fn checks_run_in_order() {
    let body = json!({"sessionId": "bad", "projectId": "a-b", "rootResourcePath": ""});
    assert_eq!(
        read_workshop_request(&body).unwrap_err(),
        SESSION_ID_INVALID
    );
}

#[test]
fn session_only_reader_accepts_session_id() {
    assert_eq!(
        read_workshop_session_id(&json!({"sessionId": SID})).unwrap(),
        SID
    );
}

#[test]
fn session_only_reader_rejects_other_bodies() {
    assert_eq!(
        read_workshop_session_id(&json!([])).unwrap_err(),
        SESSION_ID_INVALID
    );
    assert_eq!(
        read_workshop_session_id(&json!(null)).unwrap_err(),
        SESSION_ID_INVALID
    );
    assert_eq!(
        read_workshop_session_id(&json!({"sessionId": 5})).unwrap_err(),
        SESSION_ID_INVALID
    );
}

#[test]
fn redacts_secret() {
    assert_eq!(
        safe_overleaf_error("bad token abc123 here", Some("abc123")),
        "bad token [redacted] here"
    );
}

#[test]
fn empty_or_missing_secret_leaves_text_alone() {
    assert_eq!(safe_overleaf_error("keep abc", Some("")), "keep abc");
    assert_eq!(safe_overleaf_error("keep abc", None), "keep abc");
}

#[test]
fn strips_url_credentials() {
    assert_eq!(
        safe_overleaf_error("GET https://git:tok@git.overleaf.com/x failed", None),
        "GET https://git.overleaf.com/x failed"
    );
}

#[test]
fn unparsable_url_is_redacted() {
    assert_eq!(
        safe_overleaf_error("see http://[bad now", None),
        "see [redacted-url] now"
    );
}

#[test]
fn uppercase_scheme_is_still_redacted() {
    assert_eq!(
        safe_overleaf_error("HTTP://u:p@h.org/a", None),
        "http://h.org/a"
    );
}

#[test]
fn bare_scheme_is_left_alone() {
    assert_eq!(
        safe_overleaf_error("only https:// here", None),
        "only https:// here"
    );
}

#[test]
fn error_is_capped_at_500_chars() {
    let raw = "e".repeat(600);
    assert_eq!(safe_overleaf_error(&raw, None).chars().count(), 500);
}

#[test]
fn meta_parses_with_extra_whitespace() {
    let html = concat!(
        "<meta  name=\"ol-user_id\"\t content=\"u1\">",
        "<meta name=\"ol-usersEmail\" content=\"a@b.c\">",
        "<meta name=\"ol-csrfToken\" content=\"c1\">",
    );
    assert_eq!(
        parse_overleaf_meta(html),
        Some(OverleafMeta {
            user_id: "u1".into(),
            user_email: "a@b.c".into(),
            csrf_token: "c1".into(),
        })
    );
}

#[test]
fn meta_missing_email_reads_as_empty() {
    let html =
        "<meta name=\"ol-user_id\" content=\"u1\"><meta name=\"ol-csrfToken\" content=\"c1\">";
    assert_eq!(parse_overleaf_meta(html).unwrap().user_email, "");
}

#[test]
fn meta_missing_csrf_or_user_is_none() {
    let no_csrf = "<meta name=\"ol-user_id\" content=\"u1\">";
    let no_user = "<meta name=\"ol-csrfToken\" content=\"c1\">";
    assert_eq!(parse_overleaf_meta(no_csrf), None);
    assert_eq!(parse_overleaf_meta(no_user), None);
}

#[test]
fn encodes_like_js_encode_uri_component() {
    assert_eq!(encode_uri_component("a b/c?é"), "a%20b%2Fc%3F%C3%A9");
    assert_eq!(encode_uri_component("-_.!~*'()"), "-_.!~*'()");
}

#[test]
fn cdn_url_trims_slashes() {
    assert_eq!(
        cdn_pdf_url("https://cdn.x//", "/build/output.pdf", "g1", "s 1"),
        "https://cdn.x/build/output.pdf?compileGroup=g1&clsiserverid=s%201&enable_pdf_caching=true"
    );
}
