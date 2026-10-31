//! Picks the relay for an `app://` request, in the TS order. Ported from apps/desktop/src/app-relays.ts.

use std::time::Duration;

use super::account::{is_account_proxy_request, proxy_account};
use super::arxiv::{ARXIV_TIMEOUT, ARXIV_UPSTREAM, is_arxiv_proxy_request, proxy_arxiv};
use super::blob::{BLOB_TIMEOUT, BLOB_UPSTREAM, is_blob_proxy_request, proxy_blob};
use super::html::{is_html_proxy_request, proxy_html};
use super::overleaf::{is_overleaf_proxy_request, proxy_overleaf};
use super::pdf::{is_pdf_proxy_request, proxy_pdf};
use super::semantic_scholar::{
    RETRY_UNIT, SEMANTIC_SCHOLAR_TIMEOUT, SEMANTIC_SCHOLAR_UPSTREAM,
    is_semantic_scholar_proxy_request, proxy_semantic_scholar,
};
use super::shared::{Answer, RelayRequest};

/// Where the relays send requests and how long they wait.
#[derive(Debug, Clone)]
pub struct RelayConfig {
    /// The hosted app the blob, account and Overleaf routes go to.
    pub hosted_app: String,
    /// Semantic Scholar's base address, no trailing slash.
    pub semantic_scholar: String,
    /// The arXiv query address, path included.
    pub arxiv: String,
    /// How long one hosted-app request may take.
    pub timeout: Duration,
    /// Wait unit between Semantic Scholar 429 retries.
    pub retry_unit: Duration,
    /// How long one Semantic Scholar request may take.
    pub semantic_scholar_timeout: Duration,
    /// How long one arXiv request may take.
    pub arxiv_timeout: Duration,
}

impl RelayConfig {
    /// The production upstreams and timeouts, the same values the TS relays use.
    #[must_use]
    pub fn production() -> Self {
        Self {
            hosted_app: BLOB_UPSTREAM.to_string(),
            semantic_scholar: SEMANTIC_SCHOLAR_UPSTREAM.to_string(),
            arxiv: ARXIV_UPSTREAM.to_string(),
            timeout: BLOB_TIMEOUT,
            retry_unit: RETRY_UNIT,
            semantic_scholar_timeout: SEMANTIC_SCHOLAR_TIMEOUT,
            arxiv_timeout: ARXIV_TIMEOUT,
        }
    }
}

/// The relayed answer, or None when the request is not for a relay (the bundle serves it).
pub async fn answer_relay(
    client: &reqwest::Client,
    request: &RelayRequest,
    config: &RelayConfig,
) -> Option<Answer> {
    let url = &request.url;
    if is_pdf_proxy_request(url) {
        return Some(proxy_pdf(client, url).await);
    }
    if is_html_proxy_request(url) {
        return Some(proxy_html(client, url).await);
    }
    if is_semantic_scholar_proxy_request(url) {
        return Some(
            proxy_semantic_scholar(
                client,
                request,
                &config.semantic_scholar,
                config.semantic_scholar_timeout,
                config.retry_unit,
            )
            .await,
        );
    }
    if is_arxiv_proxy_request(url) {
        return Some(proxy_arxiv(client, request, &config.arxiv, config.arxiv_timeout).await);
    }
    if is_blob_proxy_request(url) {
        return Some(proxy_blob(client, request, &config.hosted_app, config.timeout).await);
    }
    if is_account_proxy_request(url) {
        return Some(proxy_account(client, request, &config.hosted_app, config.timeout).await);
    }
    if is_overleaf_proxy_request(url) {
        return Some(proxy_overleaf(client, request, &config.hosted_app, config.timeout).await);
    }
    None
}
