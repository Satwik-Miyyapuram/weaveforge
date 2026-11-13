//! Port of `isPrivateHost` and `isPublicHttpsUrl` in apps/desktop/src/proxy-shared.ts. Pure.
//!
//! Literal addresses and `localhost` names only. A name that *resolves* to a private address is
//! not caught here, because that would need a resolver. `*.local` names are not private here
//! either, as in the TS; the shape check in [`super::url_safety`] is what refuses those.

use url::Url;

use super::url_safety::{is_ip_address, is_public_address};

/// Lowercases, drops one pair of brackets around the host and one trailing dot, as the TS does.
fn normalise_host(hostname: &str) -> String {
    let lower = hostname.to_lowercase();
    let unbracketed = lower.strip_prefix('[').unwrap_or(lower.as_str());
    let unbracketed = unbracketed.strip_suffix(']').unwrap_or(unbracketed);
    unbracketed
        .strip_suffix('.')
        .unwrap_or(unbracketed)
        .to_owned()
}

/// True for `localhost`, `*.localhost`, and any literal address that is not public.
#[must_use]
pub fn is_private_host(hostname: &str) -> bool {
    let host = normalise_host(hostname);
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }
    is_ip_address(&host) && !is_public_address(&host)
}

/// True for an https URL with no credentials whose host is not private.
///
/// The URL is parsed here with the WHATWG parser, so decimal, hex and shortened IPv4 spellings
/// reach the private check already normalised, as the browser would see them.
#[must_use]
pub fn is_public_https_url(raw: &str) -> bool {
    let Ok(url) = Url::parse(raw) else {
        return false;
    };
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().unwrap_or("").is_empty()
        && !is_private_host(url.host_str().unwrap_or(""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_private_host_is_any_loopback_private_link_local_or_special_address_or_localhost() {
        for host in [
            "localhost",
            "a.localhost",
            "LOCALHOST.",
            "127.0.0.1",
            "0.0.0.0",
            "10.1.2.3",
            "100.64.0.1",
            "172.31.0.1",
            "192.168.0.1",
            "169.254.169.254",
            "198.18.0.1",
            "224.0.0.1",
            "[::1]",
            "::",
            "[::ffff:7f00:1]",
            "fd00::1",
            "fe80::1",
        ] {
            assert!(is_private_host(host), "{host}");
        }
    }

    #[test]
    fn a_public_host_is_not_private() {
        for host in ["arxiv.org", "8.8.8.8", "172.32.0.1", "[2606:4700::1111]"] {
            assert!(!is_private_host(host), "{host}");
        }
    }

    #[test]
    fn ipv4_range_edges_follow_the_core_rules() {
        // 100.63 and 100.128 sit either side of carrier-grade NAT.
        assert!(!is_private_host("100.63.255.255"));
        assert!(is_private_host("100.64.0.0"));
        assert!(is_private_host("100.127.255.255"));
        assert!(!is_private_host("100.128.0.0"));
        // 172.16/12 is private, 172.15 and 172.32 are not.
        assert!(is_private_host("172.16.0.0"));
        assert!(!is_private_host("172.15.255.255"));
        assert!(!is_private_host("172.32.0.0"));
        // 223 is still unicast, 224 is multicast.
        assert!(!is_private_host("223.255.255.255"));
        assert!(is_private_host("224.0.0.0"));
    }

    #[test]
    fn ipv6_private_ranges_are_refused_and_global_unicast_is_not() {
        assert!(is_private_host("[fc00::1]"));
        assert!(is_private_host("[fdff::1]"));
        assert!(is_private_host("[fe80::1]"));
        assert!(is_private_host("[2001:db8::1]"));
        assert!(is_private_host("[::ffff:10.0.0.1]"));
        assert!(!is_private_host("[2001:4860:4860::8888]"));
    }

    #[test]
    fn a_trailing_dot_and_brackets_are_read_away_before_the_check() {
        assert!(is_private_host("127.0.0.1."));
        assert!(is_private_host("[::1]"));
        assert!(!is_private_host("arxiv.org."));
        // A `.local` name is not private in the TS; the shape check refuses it instead.
        assert!(!is_private_host("printer.local"));
    }

    #[test]
    fn a_public_https_address_has_no_credentials_and_no_private_host_in_any_spelling() {
        assert!(is_public_https_url("https://arxiv.org/pdf/1"));
        for url in [
            "http://arxiv.org/",
            "https://u:p@arxiv.org/",
            "https://127.1/",
            "https://0x7f.1/",
            "https://2130706433/",
            "https://[::ffff:127.0.0.1]/",
            "not a url",
            "",
        ] {
            assert!(!is_public_https_url(url), "{url}");
        }
    }

    #[test]
    fn a_public_https_address_keeps_a_trailing_dot_on_a_public_name() {
        assert!(is_public_https_url("https://arxiv.org./"));
        assert!(!is_public_https_url("https://localhost./"));
    }
}
