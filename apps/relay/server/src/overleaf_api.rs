//! Overleaf's HTTP client for the workshop routes: cookie login, project list, compile and PDF download.
//! Ported from Overleaf Workshop's `src/api/base.ts`, vendored (https://github.com/iamhyc/Overleaf-Workshop)
//! under AGPL-3.0 (see `NOTICE`). Only the login, project, compile and download paths are kept.

use std::time::Duration;

use reqwest::header::{CONTENT_TYPE, COOKIE, SET_COOKIE};
use serde_json::{Value, json};
use wf_core::overleaf_workshop::{cdn_pdf_url, parse_overleaf_meta};

/// Retries after the first attempt for JSON calls.
const MAX_HTTP_RETRIES: u32 = 2;
/// Upper bound on PDF download rounds (the TS has none).
const MAX_DOWNLOAD_ROUNDS: usize = 100;
/// The message for a JSON reply that carries no body (HTTP 204).
const EMPTY_REPLY: &str = "Overleaf sent an empty response.";
/// The message for a project list reply without a `projects` array.
const PROJECTS_MISSING: &str = "Overleaf sent an unexpected project list.";

/// A logged-in Overleaf session: the CSRF token and the cookie header to send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    /// The `ol-csrfToken` from the Overleaf page.
    pub csrf_token: String,
    /// The `Cookie` header value.
    pub cookies: String,
}

/// The Overleaf HTTP client, pointed at one base URL.
pub struct OverleafApi {
    client: reqwest::Client,
    base: String,
    retry_ms: u64,
}

impl OverleafApi {
    /// Client with redirects off; `base` gets a trailing '/' when missing.
    pub fn new(base: &str, retry_ms: u64) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|err| err.to_string())?;
        let base = if base.ends_with('/') {
            base.to_string()
        } else {
            format!("{base}/")
        };
        Ok(Self {
            client,
            base,
            retry_ms,
        })
    }

    /// Logs in with `cookies`; `None` when the project page has no user meta.
    pub async fn cookies_login(&self, cookies: &str) -> Result<Option<Identity>, String> {
        let page = self
            .client
            .get(format!("{}project", self.base))
            .header(COOKIE, cookies)
            .send()
            .await
            .map_err(|err| err.to_string())?;
        let html = page.text().await.map_err(|err| err.to_string())?;
        let Some(meta) = parse_overleaf_meta(&html) else {
            return Ok(None);
        };
        let script = self
            .client
            .get(format!("{}socket.io/socket.io.js", self.base))
            .header(COOKIE, cookies)
            .send()
            .await
            .map_err(|err| err.to_string())?;
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
                let cdn = cdn_pdf_url(domain, url, group, server);
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
                    Err(err) => err.to_string(),
                },
                Ok((204, _)) => EMPTY_REPLY.to_string(),
                Ok((status, bytes)) => {
                    let message = format!("{status}: {}", String::from_utf8_lossy(&bytes));
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
                let bytes = serde_json::to_vec(&payload).map_err(|err| err.to_string())?;
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
        let response = request.send().await.map_err(|err| err.to_string())?;
        let status = response.status().as_u16();
        let bytes = response.bytes().await.map_err(|err| err.to_string())?;
        Ok((status, bytes.to_vec()))
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

    /// Fetches `url` in rounds: 200 ends it, 206 appends and repeats, anything else stops.
    async fn download(&self, url: &str, cookies: Option<&str>) -> Result<Vec<u8>, String> {
        let mut out = Vec::new();
        for _ in 0..MAX_DOWNLOAD_ROUNDS {
            let mut request = self.client.get(url);
            if let Some(cookies) = cookies {
                request = request.header(COOKIE, cookies);
            }
            let response = request.send().await.map_err(|err| err.to_string())?;
            let status = response.status().as_u16();
            if status != 200 && status != 206 {
                break;
            }
            let chunk = response.bytes().await.map_err(|err| err.to_string())?;
            out.extend_from_slice(&chunk);
            if status == 200 {
                break;
            }
        }
        Ok(out)
    }
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
