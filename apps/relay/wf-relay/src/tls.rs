//! Which certificate roots the relay's HTTP clients trust.
//!
//! Desktops use the platform's TLS and its trust store. Phones use rustls, whose
//! default verifier on Android needs JNI set-up the shell does not do, so they
//! verify against Mozilla's root list bundled in the app instead. The server
//! (`wf-relay-server`) takes the desktop path.

/// Applies the platform's roots: unchanged on desktops, the bundled list on phones.
#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn with_roots(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    builder.tls_certs_only(bundled_roots())
}

/// Applies the platform's roots: unchanged on desktops, the bundled list on phones.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub const fn with_roots(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    builder
}

/// Mozilla's server roots as reqwest certificates; one that does not parse is skipped.
#[cfg(any(target_os = "android", target_os = "ios", test))]
#[must_use]
pub fn bundled_roots() -> Vec<reqwest::Certificate> {
    webpki_root_certs::TLS_SERVER_ROOT_CERTS
        .iter()
        .filter_map(|der| reqwest::Certificate::from_der(der.as_ref()).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_bundled_root_parses() {
        let roots = bundled_roots();
        assert!(roots.len() > 100, "only {} roots", roots.len());
        assert_eq!(roots.len(), webpki_root_certs::TLS_SERVER_ROOT_CERTS.len());
    }

    #[test]
    fn a_client_builds_with_the_roots() {
        // The phone path itself: on desktops `with_roots` changes nothing.
        let client = reqwest::Client::builder()
            .tls_certs_only(bundled_roots())
            .build();
        assert!(client.is_ok());
    }
}
