//! Origin comparison for the IPC guard (TS `apps/shell/sidecar/src/ipc-guard.ts`: `sameOrigin`, `originOf`).
//! The URL parse is the `url` crate's, which follows the WHATWG rules Node's `URL` follows. Electron event
//! wiring and the refusal log stay in TypeScript.

use url::Url;

/// The parts of a URL an origin is made of: scheme with its colon, hostname, and the port as written.
struct OriginParts {
    protocol: String,
    hostname: String,
    port: String,
}

/// The default port a scheme implies, when a URL leaves the port out (TS `DEFAULT_PORTS`).
fn default_port(protocol: &str) -> Option<&'static str> {
    match protocol {
        "http:" | "ws:" => Some("80"),
        "https:" | "wss:" => Some("443"),
        "ftp:" => Some("21"),
        _ => None,
    }
}

fn parts(url: &str) -> Option<OriginParts> {
    let parsed = Url::parse(url).ok()?;
    Some(OriginParts {
        protocol: format!("{}:", parsed.scheme()),
        hostname: parsed.host_str().unwrap_or("").to_string(),
        port: parsed
            .port()
            .map(|port| port.to_string())
            .unwrap_or_default(),
    })
}

/// The port that would be named if the URL had spelled it out; for a scheme with no default, the scheme itself
/// (TS `effectivePort`, kept for parity).
fn effective_port(where_: &OriginParts) -> String {
    if !where_.port.is_empty() {
        return where_.port.clone();
    }
    default_port(&where_.protocol)
        .map(str::to_string)
        .unwrap_or_else(|| where_.protocol.clone())
}

/// Whether `url` is the same origin as `origin`. Scheme and port compare as parsed (a default port equals
/// its absent spelling); the hostname compares ignoring case. Either side failing to parse is not the same.
#[must_use]
pub fn same_origin(url: &str, origin: &str) -> bool {
    match (parts(url), parts(origin)) {
        (Some(there), Some(here)) => {
            there.protocol == here.protocol
                && there.hostname.to_lowercase() == here.hostname.to_lowercase()
                && effective_port(&there) == effective_port(&here)
        }
        _ => false,
    }
}

/// The origin of `url`, spelled the way [`same_origin`] reads it back (`scheme://host[:port]`), or `None` when
/// `url` does not parse (TS `originOf` throws there).
#[must_use]
pub fn origin_of(url: &str) -> Option<String> {
    let p = parts(url)?;
    let port = if p.port.is_empty() {
        String::new()
    } else {
        format!(":{}", p.port)
    };
    Some(format!("{}//{}{}", p.protocol, p.hostname, port))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_origin_folds_hostname_case_for_custom_schemes() {
        assert!(same_origin("app://WeaveForge/", "app://weaveforge/"));
        assert!(same_origin("http://App.Example/x", "http://app.example"));
    }

    #[test]
    fn same_origin_treats_default_port_as_absent() {
        assert!(same_origin("https://a.com:443/x", "https://a.com"));
        assert!(!same_origin("https://a.com:8443/x", "https://a.com"));
    }

    #[test]
    fn same_origin_needs_matching_scheme_and_host() {
        assert!(!same_origin("http://a.com", "https://a.com"));
        assert!(!same_origin("https://a.com", "https://b.com"));
    }

    #[test]
    fn same_origin_refuses_unparseable_input() {
        assert!(!same_origin("not a url", "https://a.com"));
        assert!(!same_origin("https://a.com", "nope"));
    }

    #[test]
    fn origin_of_spells_scheme_host_and_port() {
        assert_eq!(
            origin_of("app://WeaveForge/").as_deref(),
            Some("app://WeaveForge")
        );
        assert_eq!(
            origin_of("https://a.com:443/x").as_deref(),
            Some("https://a.com")
        );
        assert_eq!(
            origin_of("http://a.com:8080/x").as_deref(),
            Some("http://a.com:8080")
        );
    }

    #[test]
    fn origin_of_round_trips_through_same_origin() {
        let origin = origin_of("app://weaveforge:9000/index").expect("parses");
        assert!(same_origin("app://weaveforge:9000/other", &origin));
    }

    #[test]
    fn origin_of_refuses_unparseable_input() {
        assert_eq!(origin_of("not a url"), None);
    }
}
