//! Overleaf's HTTP client for the workshop routes: cookie login, project list, compile and PDF download.
//! Ported from Overleaf Workshop's `src/api/base.ts`, vendored (https://github.com/iamhyc/Overleaf-Workshop)
//! under AGPL-3.0 (see `NOTICE`). Only the login, project, compile and download paths are kept.

use std::time::{Duration, Instant};

use reqwest::header::{CONTENT_RANGE, CONTENT_TYPE, COOKIE, SET_COOKIE};
use serde_json::{Value, json};
use wf_core::overleaf_workshop::{cdn_pdf_url, parse_overleaf_meta, pdf_domain_allowed};

use crate::safe_error::transport_log_line;

/// The log context for this client.
const CONTEXT: &str = "overleaf";
/// The message for a request that never got a reply; the URL stays out.
const REACH_FAILED: &str = "Could not reach Overleaf.";
/// The message for a 200 reply that does not parse as JSON.
const NOT_JSON: &str = "Overleaf sent a reply that is not JSON.";
/// Retries after the first attempt for JSON calls.
const MAX_HTTP_RETRIES: u32 = 2;
/// Upper bound on PDF download rounds (the TS has none).
const MAX_DOWNLOAD_ROUNDS: usize = 100;
/// Upper bound on PDF bytes kept across download rounds.
const MAX_DOWNLOAD_BYTES: u64 = 256 * 1024 * 1024;
/// Upper bound on the bytes of a JSON reply or the login page.
const MAX_REPLY_BYTES: u64 = 16 * 1024 * 1024;
/// The message for a JSON reply or login page past the reply cap.
const TOO_LARGE: &str = "Overleaf sent a reply that is too large.";
/// The message for a compile that names a PDF host outside the allowlist.
const HOST_REFUSED: &str = "Overleaf named a PDF host that is not allowed.";
/// The message for a PDF download that stopped before its end.
const INCOMPLETE: &str = "Overleaf sent an incomplete PDF.";
/// The message for an HTTP client that could not be built.
const CLIENT_FAILED: &str = "Could not set up the Overleaf client on the relay.";
/// The message for a request body that could not be encoded.
const BODY_FAILED: &str = "Could not build the Overleaf request.";
/// The message for a JSON reply that carries no body (HTTP 204).
const EMPTY_REPLY: &str = "Overleaf sent an empty response.";
/// The message for a project list reply without a `projects` array.
const PROJECTS_MISSING: &str = "Overleaf sent an unexpected project list.";

/// A logged-in Overleaf session: the CSRF token and the cookie header to send.
#[derive(Clone, PartialEq, Eq)]
pub struct Identity {
    /// The `ol-csrfToken` from the Overleaf page.
    pub csrf_token: String,
    /// The `Cookie` header value.
    pub cookies: String,
}

/// Both fields are session secrets, so a debug print shows neither.
impl std::fmt::Debug for Identity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Identity")
            .field("csrf_token", &"<redacted>")
            .field("cookies", &"<redacted>")
            .finish()
    }
}

/// How long a request may take and how big a PDF may be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Time allowed to open the connection.
    pub connect: Duration,
    /// Time allowed for a whole request, body included (sized for a large PDF).
    pub total: Duration,
    /// Time allowed for a whole PDF download, all rounds together: no round starts after
    /// it, and each later round is cut off when it runs out.
    pub download_total: Duration,
    /// Upper bound on PDF bytes kept across download rounds.
    pub max_download_bytes: u64,
    /// Upper bound on the bytes of a JSON reply or the login page.
    pub max_reply_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            connect: Duration::from_secs(10),
            total: Duration::from_secs(120),
            download_total: Duration::from_secs(300),
            max_download_bytes: MAX_DOWNLOAD_BYTES,
            max_reply_bytes: MAX_REPLY_BYTES,
        }
    }
}

/// The Overleaf HTTP client, pointed at one base URL.
pub struct OverleafApi {
    client: reqwest::Client,
    base: String,
    retry_ms: u64,
    request_total: Duration,
    download_total: Duration,
    max_download_bytes: u64,
    max_reply_bytes: u64,
}

impl OverleafApi {
    /// Client with redirects off and the default [`Limits`]; `base` gets a trailing '/' when
    /// missing.
    pub fn new(base: &str, retry_ms: u64) -> Result<Self, String> {
        Self::with_limits(base, retry_ms, Limits::default())
    }

    /// As [`OverleafApi::new`], with the given time and size limits.
    pub fn with_limits(base: &str, retry_ms: u64, limits: Limits) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(limits.connect)
            .timeout(limits.total)
            .build()
            .map_err(|_| {
                // A local setup fault (TLS backend), not Overleaf being unreachable.
                eprintln!("[{CONTEXT}] client build failed");
                CLIENT_FAILED.to_string()
            })?;
        let base = if base.ends_with('/') {
            base.to_string()
        } else {
            format!("{base}/")
        };
        Ok(Self {
            client,
            base,
            retry_ms,
            request_total: limits.total,
            download_total: limits.download_total,
            max_download_bytes: limits.max_download_bytes,
            max_reply_bytes: limits.max_reply_bytes,
        })
    }

    /// Logs in with `cookies`; `None` when the project page has no user meta.
    pub async fn cookies_login(&self, cookies: &str) -> Result<Option<Identity>, String> {
        let mut page = self
            .client
            .get(format!("{}project", self.base))
            .header(COOKIE, cookies)
            .send()
            .await
            .map_err(|err| unreached(&err))?;
        let html = body_within(&mut page, self.max_reply_bytes).await?;
        let html = String::from_utf8_lossy(&html);
        let Some(meta) = parse_overleaf_meta(&html) else {
            return Ok(None);
        };
        let script = self
            .client
            .get(format!("{}socket.io/socket.io.js", self.base))
            .header(COOKIE, cookies)
            .send()
            .await
            .map_err(|err| unreached(&err))?;
        let pair = script
            .headers()
            .get(SET_COOKIE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .unwrap_or("");
        let cookies = if pair.is_empty() {
            cookies.to_string()
        } else {
            format!("{cookies}; {pair}")
        };
        Ok(Some(Identity {
            csrf_token: meta.csrf_token,
            cookies,
        }))
    }

    /// The user's projects, each with `_id` moved to `id`.
    pub async fn user_projects(&self, identity: &Identity) -> Result<Vec<Value>, String> {
        let body = self.request(identity, "user/projects", None, &[]).await?;
        match body.get("projects") {
            Some(Value::Array(projects)) => Ok(projects.iter().cloned().map(with_id).collect()),
            _ => Err(PROJECTS_MISSING.to_string()),
        }
    }

    /// Starts a compile of `root` in `project_id`; returns the reply object.
    /// With no `root`, Overleaf compiles the project's main document.
    pub async fn compile(
        &self,
        identity: &Identity,
        project_id: &str,
        root: Option<&str>,
    ) -> Result<Value, String> {
        let mut body = json!({
            "check": "silent",
            "draft": false,
            "incrementalCompilesEnabled": true,
            "stopOnFirstError": false
        });
        if let Some(root) = root {
            body["rootResourcePath"] = json!(root);
        }
        let route = format!("project/{project_id}/compile?auto_compile=true");
        let csrf = [("X-Csrf-Token", identity.csrf_token.as_str())];
        self.request(identity, &route, Some(&body), &csrf).await
    }

    /// Downloads a compiled output: from the CDN (no cookies) when the compile names one, else from base.
    pub async fn get_file_from_clsi(
        &self,
        identity: &Identity,
        url: &str,
        group: &str,
        server: Option<&str>,
        domain: Option<&str>,
    ) -> Result<Vec<u8>, String> {
        match (
            domain.filter(|domain| !domain.is_empty()),
            server.filter(|server| !server.is_empty()),
        ) {
            (Some(domain), Some(server)) => {
                // The domain comes from Overleaf's reply: fetch only allowlisted hosts.
                if !pdf_domain_allowed(domain, &self.base) {
                    eprintln!("[{CONTEXT}] pdf host refused");
                    return Err(HOST_REFUSED.to_string());
                }
                // Build from the parsed origin the check saw, never the raw string.
                let origin = ::url::Url::parse(domain)
                    .map(|parsed| parsed.origin().ascii_serialization())
                    .map_err(|_| HOST_REFUSED.to_string())?;
                let cdn = cdn_pdf_url(&origin, url, group, server);
                self.download(&cdn, None).await
            }
            _ => {
                let route = format!("{}{}", self.base, url.trim_start_matches('/'));
                self.download(&route, Some(&identity.cookies)).await
            }
        }
    }

    /// One JSON call with the TS retry rules: transport and parse errors and 5xx/429 are retried.
    async fn request(
        &self,
        identity: &Identity,
        route: &str,
        post: Option<&Value>,
        extra: &[(&str, &str)],
    ) -> Result<Value, String> {
        let mut attempt: u32 = 0;
        loop {
            let last = attempt >= MAX_HTTP_RETRIES;
            let failure = match self.send(identity, route, post, extra).await {
                Ok((200, bytes)) => match serde_json::from_slice::<Value>(&bytes) {
                    Ok(value) => return Ok(value),
                    Err(_) => NOT_JSON.to_string(),
                },
                Ok((204, _)) => EMPTY_REPLY.to_string(),
                Ok((status, _)) => {
                    // The body is Overleaf's own page and may carry account details; only the status leaves.
                    eprintln!("[{CONTEXT}] HTTP {status}");
                    let message = format!("Overleaf refused the request (HTTP {status}).");
                    if !(status >= 500 || status == 429) || last {
                        return Err(message);
                    }
                    message
                }
                Err(err) => err,
            };
            if last {
                return Err(failure);
            }
            self.pause(attempt).await;
            attempt = attempt.saturating_add(1);
        }
    }

    /// One HTTP exchange: the status and body bytes. POST bodies get `_csrf` added.
    async fn send(
        &self,
        identity: &Identity,
        route: &str,
        post: Option<&Value>,
        extra: &[(&str, &str)],
    ) -> Result<(u16, Vec<u8>), String> {
        let url = format!("{}{route}", self.base);
        let mut request = match post {
            Some(body) => {
                let mut payload = body.clone();
                if let Some(object) = payload.as_object_mut() {
                    let _previous = object.insert(
                        "_csrf".to_string(),
                        Value::from(identity.csrf_token.as_str()),
                    );
                }
                let bytes = serde_json::to_vec(&payload).map_err(|_| BODY_FAILED.to_string())?;
                self.client
                    .post(url)
                    .header(CONTENT_TYPE, "application/json")
                    .body(bytes)
            }
            None => self.client.get(url),
        };
        request = request.header(COOKIE, identity.cookies.as_str());
        for (name, value) in extra {
            request = request.header(*name, *value);
        }
        let mut response = request.send().await.map_err(|err| unreached(&err))?;
        let status = response.status().as_u16();
        let bytes = body_within(&mut response, self.max_reply_bytes).await?;
        Ok((status, bytes))
    }

    /// Sleeps `retry_ms * 2^attempt`, capped at `4 * retry_ms`.
    async fn pause(&self, attempt: u32) {
        let factor = 1u64.checked_shl(attempt).unwrap_or(u64::MAX);
        let ms = self
            .retry_ms
            .saturating_mul(factor)
            .min(self.retry_ms.saturating_mul(4));
        tokio::time::sleep(Duration::from_millis(ms)).await;
    }

    /// Fetches `url` in rounds: a first 200 is the whole PDF, 206 appends and repeats.
    ///
    /// A first reply that is neither gives an empty result (nothing was compiled). Once bytes
    /// have arrived, any other status, a 200 (a whole body cannot follow part of one), a length
    /// that misses the `Content-Range` total, a chunk that does not start where the last one
    /// ended, a missing, bad or changed `Content-Range` on a 206, a broken or timed-out reply,
    /// the byte cap, the round cap or the whole-download time budget is an error: a truncated
    /// or spliced PDF never passes as a whole one.
    async fn download(&self, url: &str, cookies: Option<&str>) -> Result<Vec<u8>, String> {
        let started = Instant::now();
        let mut out = Vec::new();
        let mut total: Option<u64> = None;
        for round in 0..MAX_DOWNLOAD_ROUNDS {
            let mut request = self.client.get(url);
            if let Some(cookies) = cookies {
                request = request.header(COOKIE, cookies);
            }
            if round > 0 {
                // The first round is held to the per-request limit; later ones share what is left.
                let left = self.download_total.saturating_sub(started.elapsed());
                if left.is_zero() {
                    return Err(incomplete("ran out of time"));
                }
                request = request.timeout(left.min(self.request_total));
            }
            // Before any reply was taken, a failure is Overleaf out of reach; after, a cut-off PDF.
            let response = request.send().await.map_err(|err| {
                if round == 0 {
                    unreached(&err)
                } else {
                    incomplete_after(&err)
                }
            })?;
            let status = response.status().as_u16();
            if status != 200 && status != 206 {
                if round == 0 {
                    return Ok(out);
                }
                return Err(incomplete(&format!("stopped at HTTP {status}")));
            }
            if status == 200 && round > 0 {
                return Err(incomplete("sent a whole reply after a partial one"));
            }
            check_range(&response, status, out.len(), &mut total)?;
            // Read piece by piece so the byte cap stops a huge body before it is all held.
            let mut response = response;
            loop {
                let piece = match response.chunk().await {
                    Ok(Some(piece)) => piece,
                    Ok(None) => break,
                    Err(err) if round == 0 && out.is_empty() => return Err(unreached(&err)),
                    Err(err) => return Err(incomplete_after(&err)),
                };
                out.extend_from_slice(&piece);
                if u64::try_from(out.len()).unwrap_or(u64::MAX) > self.max_download_bytes {
                    return Err(incomplete("passed the size cap"));
                }
            }
            let length = u64::try_from(out.len()).unwrap_or(u64::MAX);
            match total {
                Some(total) if length > total => return Err(incomplete("longer than its range")),
                Some(total) if length == total => return Ok(out),
                Some(_) if status == 200 => return Err(incomplete("shorter than its range")),
                _ if status == 200 => return Ok(out),
                _ => {}
            }
        }
        Err(incomplete("hit the round cap"))
    }
}

/// Checks a reply's `Content-Range` against the `received` bytes and the `total` seen so far
/// (set from the first total named). A 206 must carry one, starting where the last part ended.
fn check_range(
    response: &reqwest::Response,
    status: u16,
    received: usize,
    total: &mut Option<u64>,
) -> Result<(), String> {
    let Some((start, range_total)) = content_range(response) else {
        return Err(incomplete("sent a bad Content-Range"));
    };
    if status == 206 && start.is_none() {
        return Err(incomplete("sent a part without a Content-Range"));
    }
    let received = u64::try_from(received).unwrap_or(u64::MAX);
    if start.is_some_and(|start| start != received) {
        return Err(incomplete("chunk out of order"));
    }
    match (*total, range_total) {
        (Some(known), Some(new)) if known != new => Err(incomplete("changed its total")),
        (None, Some(_)) => {
            *total = range_total;
            Ok(())
        }
        _ => Ok(()),
    }
}

/// Reads a reply body piece by piece, stopping once it passes `cap` bytes.
async fn body_within(response: &mut reqwest::Response, cap: u64) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    while let Some(piece) = response.chunk().await.map_err(|err| unreached(&err))? {
        out.extend_from_slice(&piece);
        if u64::try_from(out.len()).unwrap_or(u64::MAX) > cap {
            eprintln!("[{CONTEXT}] reply passed the size cap");
            return Err(TOO_LARGE.to_string());
        }
    }
    Ok(out)
}

/// The start and total of a `Content-Range: bytes a-b/total` header (total `None` for `*`).
/// `Some((None, None))` when there is no header; `None` when the header does not parse.
fn content_range(response: &reqwest::Response) -> Option<(Option<u64>, Option<u64>)> {
    let Some(value) = response.headers().get(CONTENT_RANGE) else {
        return Some((None, None));
    };
    let range = value.to_str().ok()?.trim().strip_prefix("bytes ")?;
    let (span, total) = range.split_once('/')?;
    let (start, end) = span.trim().split_once('-')?;
    let start: u64 = start.trim().parse().ok()?;
    let end: u64 = end.trim().parse().ok()?;
    let total = match total.trim() {
        "*" => None,
        total => Some(total.parse::<u64>().ok()?),
    };
    let consistent = start <= end && total.is_none_or(|total| end < total);
    consistent.then_some((Some(start), total))
}

/// Logs why a download stopped short and returns the fixed message.
fn incomplete(why: &str) -> String {
    eprintln!("[{CONTEXT}] download {why}");
    INCOMPLETE.to_string()
}

/// A request or body that failed once part of the PDF was taken: logged by kind, cut-off message.
fn incomplete_after(err: &reqwest::Error) -> String {
    eprintln!("{}", transport_log_line(err, CONTEXT));
    INCOMPLETE.to_string()
}

/// Logs a failed request by kind and returns the fixed message: the error's text names the URL.
fn unreached(err: &reqwest::Error) -> String {
    eprintln!("{}", transport_log_line(err, CONTEXT));
    REACH_FAILED.to_string()
}

/// Moves a project's `_id` to `id`, as the TS does.
fn with_id(mut project: Value) -> Value {
    if let Some(object) = project.as_object_mut()
        && let Some(id) = object.remove("_id")
    {
        let _previous = object.insert("id".to_string(), id);
    }
    project
}
