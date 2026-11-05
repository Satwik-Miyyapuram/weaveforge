//! Account deletion relay to the hosted app. Ported from apps/desktop/src/account-proxy.ts.

use std::time::Duration;

use reqwest::Url;

use super::blob::relay_to_hosted_app;
use super::shared::{Answer, RelayRequest, refuse};

/// Paths the page posts account deletion to.
pub const ACCOUNT_PROXY_PATHS: [&str; 2] =
    ["/api/account/delete-user", "/api/account/delete-user/otp"];

/// Whether the request path is exactly one of the two account deletion paths.
#[must_use]
pub fn is_account_proxy_request(url: &Url) -> bool {
    ACCOUNT_PROXY_PATHS.contains(&url.path())
}

/// Relays one account deletion request to the hosted app. Only POST goes; the query is not forwarded.
pub async fn proxy_account(
    client: &reqwest::Client,
    request: &RelayRequest,
    upstream: &str,
    timeout: Duration,
) -> Answer {
    if !request.method.eq_ignore_ascii_case("POST") {
        return Answer::from(refuse(405, "Method not allowed"));
    }
    relay_to_hosted_app(
        client,
        request,
        request.url.path(),
        upstream,
        timeout,
        "account",
    )
    .await
}
