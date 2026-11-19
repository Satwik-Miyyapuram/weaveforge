//! Server profile origins and `weaveforge://server` links (modes-093 section 3).

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use wf_core::settings::server_profile::{
    ServerProfileError, parse_server_link, parse_server_origin,
};

#[test]
fn accepts_an_https_origin() {
    assert_eq!(
        parse_server_origin("https://weaveforge.example.org").unwrap(),
        "https://weaveforge.example.org"
    );
}

#[test]
fn accepts_a_trailing_slash_and_drops_it() {
    assert_eq!(
        parse_server_origin("https://weaveforge.example.org/").unwrap(),
        "https://weaveforge.example.org"
    );
}

#[test]
fn lowercases_the_host_and_drops_default_port() {
    assert_eq!(
        parse_server_origin("https://WeaveForge.Example.org:443").unwrap(),
        "https://weaveforge.example.org"
    );
}

#[test]
fn keeps_a_non_default_port() {
    assert_eq!(
        parse_server_origin("https://localhost:8443").unwrap(),
        "https://localhost:8443"
    );
}

#[test]
fn rejects_plain_http() {
    assert_eq!(
        parse_server_origin("http://weaveforge.example.org"),
        Err(ServerProfileError::NotHttps)
    );
}

#[test]
fn rejects_other_schemes() {
    assert_eq!(
        parse_server_origin("ftp://weaveforge.example.org"),
        Err(ServerProfileError::NotHttps)
    );
}

#[test]
fn rejects_embedded_credentials() {
    assert_eq!(
        parse_server_origin("https://user:pw@weaveforge.example.org"),
        Err(ServerProfileError::HasCredentials)
    );
}

#[test]
fn rejects_a_path() {
    assert_eq!(
        parse_server_origin("https://weaveforge.example.org/api"),
        Err(ServerProfileError::HasPathOrQuery)
    );
}

#[test]
fn rejects_a_query_or_fragment() {
    assert_eq!(
        parse_server_origin("https://weaveforge.example.org?x=1"),
        Err(ServerProfileError::HasPathOrQuery)
    );
    assert_eq!(
        parse_server_origin("https://weaveforge.example.org#top"),
        Err(ServerProfileError::HasPathOrQuery)
    );
}

#[test]
fn rejects_empty_and_unparseable_input() {
    assert_eq!(parse_server_origin("   "), Err(ServerProfileError::Invalid));
    assert_eq!(parse_server_origin("not a url"), Err(ServerProfileError::Invalid));
}

#[test]
fn parses_a_server_link_with_url_and_name() {
    let link = parse_server_link(
        "weaveforge://server?url=https%3A%2F%2Fwf.example.org&name=Lab%20server",
    )
    .unwrap();
    assert_eq!(link.origin, "https://wf.example.org");
    assert_eq!(link.name.as_deref(), Some("Lab server"));
}

#[test]
fn server_link_name_is_optional() {
    let link = parse_server_link("weaveforge://server?url=https%3A%2F%2Fwf.example.org").unwrap();
    assert_eq!(link.name, None);
}

#[test]
fn server_link_rejects_another_action() {
    assert_eq!(
        parse_server_link("weaveforge://auth?url=https%3A%2F%2Fwf.example.org"),
        Err(ServerProfileError::NotServerLink)
    );
}

#[test]
fn server_link_rejects_a_missing_url() {
    assert_eq!(
        parse_server_link("weaveforge://server?name=x"),
        Err(ServerProfileError::Invalid)
    );
}

#[test]
fn server_link_rejects_an_http_url() {
    assert_eq!(
        parse_server_link("weaveforge://server?url=http%3A%2F%2Fwf.example.org"),
        Err(ServerProfileError::NotHttps)
    );
}
