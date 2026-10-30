//! Tests for the URL shape checks (ported from packages/core/test/net/url-safety.test.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::time::Duration;

use weaveforge_shell::fetch::url_shape::{
    DEFAULT_FETCH_LIMITS, UrlRejection, check_url_shape_str, describe_rejection, parse_user_url,
};

fn reason(input: &str) -> Option<&'static str> {
    check_url_shape_str(input).err().map(UrlRejection::as_str)
}

fn ok(input: &str) {
    assert_eq!(reason(input), None, "{input} should be allowed");
}

fn no(input: &str, code: &str) {
    assert_eq!(
        reason(input),
        Some(code),
        "{input} refused for the wrong reason"
    );
}

#[test]
fn ordinary_public_addresses_are_allowed() {
    for url in [
        "https://example.com/page",
        "http://example.com:8080/page",
        "https://sub.domain.example.co.uk/a?b=c#d",
        "https://arxiv.org/abs/1706.03762",
        "example.com/page",
    ] {
        ok(url);
    }
}

#[test]
fn only_http_and_https() {
    for url in [
        "file:///etc/passwd",
        "ftp://example.com/x",
        "gopher://example.com",
    ] {
        no(url, "scheme");
    }
    // A scheme-less string is read as https, not refused.
    assert_eq!(
        parse_user_url("example.com").map(|u| u.scheme().to_string()),
        Some("https".to_string())
    );
}

#[test]
fn the_cloud_metadata_endpoints_are_refused_by_address() {
    no(
        "http://169.254.169.254/latest/meta-data/",
        "private-address",
    );
    no("http://169.254.170.2/v2/credentials", "private-address");
    no(
        "http://[fd00:ec2::254]/latest/meta-data/",
        "private-address",
    );
    no("http://192.0.0.192/latest/", "private-address");
    no(
        "http://metadata.google.internal/computeMetadata/v1/",
        "hostname",
    );
}

#[test]
fn loopback_private_and_link_local_literals_are_refused() {
    for host in [
        "127.0.0.1",
        "127.1.2.3",
        "10.0.0.5",
        "172.16.0.1",
        "172.31.255.255",
        "192.168.1.1",
        "169.254.1.1",
        "100.64.0.1",
        "0.0.0.0",
        "224.0.0.1",
        "255.255.255.255",
        "198.18.0.1",
    ] {
        no(&format!("http://{host}/"), "private-address");
    }
    // Just outside each private range is public again.
    for host in [
        "172.15.0.1",
        "172.32.0.1",
        "100.63.0.1",
        "100.128.0.1",
        "11.0.0.1",
    ] {
        ok(&format!("http://{host}/"));
    }
}

#[test]
fn ipv6_loopback_unique_local_and_mapped_v4_are_refused() {
    for host in [
        "[::1]",
        "[::]",
        "[fe80::1]",
        "[fc00::1]",
        "[fd12:3456::1]",
        "[ff02::1]",
        "[::ffff:127.0.0.1]",
        "[::ffff:10.0.0.1]",
        "[64:ff9b::7f00:1]",
        "[2001:db8::1]",
    ] {
        no(&format!("http://{host}/"), "private-address");
    }
    ok("http://[2606:4700:4700::1111]/");
}

#[test]
fn names_that_mean_this_machine_are_refused_before_dns_is_asked() {
    for host in [
        "localhost",
        "app.localhost",
        "printer.local",
        "db.internal",
        "x.home.arpa",
        "y.onion",
    ] {
        no(&format!("http://{host}/"), "hostname");
    }
    // A bare label with no dot is an intranet name.
    no("http://intranet/", "hostname");
}

#[test]
fn credentials_in_the_url_are_refused() {
    no("http://user:pass@example.com/", "credentials");
    no("http://user@example.com/", "credentials");
}

#[test]
fn ports_are_an_allowlist() {
    ok("https://example.com:443/");
    ok("http://example.com:8080/");
    for port in [22, 25, 6379, 5432, 9200, 11211, 27017] {
        no(&format!("http://example.com:{port}/"), "port");
    }
}

#[test]
fn the_project_stack_ports_are_not_outbound_ports() {
    no("http://example.com:3000/", "port");
    no("http://example.com:5000/", "port");
    ok("http://example.com:8000/");
    ok("http://example.com:8008/");
}

#[test]
fn a_trailing_dot_does_not_smuggle_a_name_past_the_checks() {
    no("http://localhost./", "hostname");
}

#[test]
fn parse_user_url_cases() {
    assert!(parse_user_url("").is_none());
    assert!(parse_user_url("  \u{FEFF} ").is_none());
    assert_eq!(
        parse_user_url("example.com/x").map(|u| u.to_string()),
        Some("https://example.com/x".to_string())
    );
    assert_eq!(
        parse_user_url("  https://a.b/  ").map(|u| u.to_string()),
        Some("https://a.b/".to_string())
    );
    let upper = parse_user_url("HTTP://A.B").expect("parses");
    assert_eq!(upper.scheme(), "http");
    assert_eq!(upper.host_str(), Some("a.b"));
    // Read as scheme "localhost", so the scheme check refuses it.
    let local = parse_user_url("localhost:3000").expect("parses");
    assert_eq!(local.scheme(), "localhost");
    assert_eq!(reason("localhost:3000"), Some("scheme"));
    assert!(parse_user_url("http://").is_none());
}

#[test]
fn default_ports_read_as_none() {
    ok("https://a.example:443/");
    ok("http://a.example:80/");
    // 443 is allowed over http too.
    ok("http://a.example:443/");
    no("https://a.example:22/", "port");
    no("https://a.example:0/", "port");
}

#[test]
fn order_of_checks() {
    no("ftp://user:pw@10.0.0.1:22/", "scheme");
    no("https://user@10.0.0.1:22/", "credentials");
    no("https://10.0.0.1:22/", "port");
    no("https://:pw@a.example/", "credentials");
}

#[test]
fn host_rules() {
    no("https://LOCALHOST./", "hostname");
    no("https://x.home.arpa/", "hostname");
    no("https://x.onion/", "hostname");
    no("https://intranet/", "hostname");
    // One trailing dot is stripped, so "localhost." has a dot and is not an IP: allowed, as in the TS.
    ok("https://localhost../");
    no("https://[::1]/", "private-address");
    ok("https://[2606:4700::1111]/");
    // WHATWG reads these as 127.0.0.1.
    no("https://127.1/", "private-address");
    no("https://0x7f.0.0.1/", "private-address");
}

#[test]
fn describe_rejection_copy() {
    assert_eq!(
        describe_rejection(UrlRejection::NotAUrl),
        "That is not a web address."
    );
    assert_eq!(
        describe_rejection(UrlRejection::Scheme),
        "Only http and https addresses can be fetched."
    );
    assert_eq!(
        describe_rejection(UrlRejection::Credentials),
        "Addresses carrying a username or password are not fetched."
    );
    assert_eq!(
        describe_rejection(UrlRejection::Port),
        "That port is not one WeaveForge will fetch from."
    );
    assert_eq!(
        describe_rejection(UrlRejection::PrivateAddress),
        "That address is on a private network, so it is not fetched."
    );
    assert_eq!(
        describe_rejection(UrlRejection::Hostname),
        "That host is not reachable from the public internet."
    );
}

#[test]
fn rejection_codes_match_ts() {
    assert_eq!(UrlRejection::NotAUrl.as_str(), "not-a-url");
    assert_eq!(UrlRejection::Scheme.as_str(), "scheme");
    assert_eq!(UrlRejection::Credentials.as_str(), "credentials");
    assert_eq!(UrlRejection::Port.as_str(), "port");
    assert_eq!(UrlRejection::PrivateAddress.as_str(), "private-address");
    assert_eq!(UrlRejection::Hostname.as_str(), "hostname");
}

#[test]
fn default_limits() {
    assert_eq!(DEFAULT_FETCH_LIMITS.max_redirects, 4);
    assert_eq!(DEFAULT_FETCH_LIMITS.max_bytes, 8_388_608);
    assert_eq!(DEFAULT_FETCH_LIMITS.timeout, Duration::from_secs(10));
}
