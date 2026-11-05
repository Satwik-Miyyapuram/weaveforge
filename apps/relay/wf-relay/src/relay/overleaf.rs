//! Overleaf Workshop relay: the four `/api/overleaf/workshop/*` routes, sent to the hosted app. Ported from apps/desktop/src/overleaf-proxy.ts.

use std::time::Duration;

use reqwest::Url;

use super::blob::relay_to_hosted_app;
use super::shared::{Answer, RelayRequest, refuse};

/// Each Workshop route and the methods its server route answers.
pub const OVERLEAF_PROXY_ROUTES: [(&str, &[&str]); 4] = [
    ("/api/overleaf/workshop/session", &["POST", "DELETE"]),
    ("/api/overleaf/workshop/projects", &["POST"]),
    ("/api/overleaf/workshop/compile", &["POST"]),
    ("/api/overleaf/workshop/pdf", &["POST"]),
];

/// Whether the request path is exactly one of the four Workshop routes.
#[must_use]
pub fn is_overleaf_proxy_request(url: &Url) -> bool {
    OVERLEAF_PROXY_ROUTES
        .iter()
        .any(|(path, _)| *path == url.path())
}

/// The methods a Workshop route answers, or `None` for a path that is not one.
fn methods_for(path: &str) -> Option<&'static [&'static str]> {
    OVERLEAF_PROXY_ROUTES
        .iter()
        .find(|(route, _)| *route == path)
        .map(|(_, methods)| *methods)
}

/// Relays one Workshop request to the hosted app. A method the route does not answer is a 405, sent nowhere.
pub async fn proxy_overleaf(
    client: &reqwest::Client,
    request: &RelayRequest,
    upstream: &str,
    timeout: Duration,
) -> Answer {
    let path = request.url.path();
    let method = request.method.to_ascii_uppercase();
    let allowed = methods_for(path).is_some_and(|methods| methods.iter().any(|m| *m == method));
    if !allowed {
        return Answer::from(refuse(405, "Method not allowed"));
    }
    let path_and_query = match request.url.query() {
        Some(query) if !query.is_empty() => format!("{path}?{query}"),
        _ => path.to_string(),
    };
    relay_to_hosted_app(
        client,
        request,
        &path_and_query,
        upstream,
        timeout,
        "overleaf",
    )
    .await
}
