//! Overleaf Workshop routes at `/api/overleaf/workshop/*`, served by the shell so the panel works
//! in a copy with no account. Ports the hosted routes (apps/web/src/app/api/overleaf/workshop) and
//! the vendored `BaseAPI` flow. Session cookies are kept under a random id; the newest one is also
//! saved in the OS keychain (`overleaf-session`), so the sign-in survives a restart.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{Value, json};
use wf_core::overleaf_workshop::{
    cdn_pdf_url, parse_overleaf_meta, read_workshop_request, read_workshop_session_id,
    safe_overleaf_error,
};

use crate::relay::shared::{Answer, read_capped};

/// Every Workshop route starts with this.
pub const PREFIX: &str = "/api/overleaf/workshop/";
/// Overleaf's public host. The cookie is sent only here.
const BASE: &str = "https://www.overleaf.com/";
/// The answer for an unknown session id.
const NOT_FOUND: &str = "Overleaf session not found. Sign in again.";
/// The largest page or JSON reply read.
const MAX_TEXT: usize = 16 * 1024 * 1024;
/// The largest PDF read.
const MAX_PDF: usize = 200 * 1024 * 1024;
/// Waits before the two retries of a 5xx, 429 or network failure, as in `BaseAPI.request`.
const RETRY_DELAYS_MS: [u64; 2] = [1000, 2000];

/// The keychain entry holding the newest session as `{"id","cookies"}`.
const SAVED_SESSION: &str = "overleaf-session";

/// Signed-in Overleaf cookies by session id. With a keychain, the newest is saved there too.
#[derive(Default)]
pub struct WorkshopSessions {
    map: Mutex<HashMap<String, String>>,
    keychain: Option<crate::secrets::Secrets>,
}

impl WorkshopSessions {
    /// Sessions backed by `secrets`, starting with the one saved before the last quit, if any.
    /// Reads the keychain, so it blocks briefly.
    #[must_use]
    pub fn remembered(secrets: crate::secrets::Secrets) -> Self {
        let mut map = HashMap::new();
        if let Some((id, cookies)) = secrets
            .read(SAVED_SESSION)
            .ok()
            .flatten()
            .and_then(|saved| parse_saved(&saved))
        {
            let _ = map.insert(id, cookies);
        }
        Self {
            map: Mutex::new(map),
            keychain: Some(secrets),
        }
    }

    /// Saves `id` as the session to restore after a restart. Without a keychain, or when it
    /// refuses (too long), the session stays in memory only.
    async fn save(&self, id: &str, cookies: &str) {
        let Some(secrets) = &self.keychain else {
            return;
        };
        let saved = json!({ "id": id, "cookies": cookies }).to_string();
        let _ = secrets
            .queued(move |s| s.write(SAVED_SESSION, &saved))
            .await;
    }

    /// Forgets `id`, and the saved session when it is that one.
    async fn sign_out(&self, id: &str) {
        self.remove(id);
        let Some(secrets) = &self.keychain else {
            return;
        };
        let id = id.to_owned();
        let _ = secrets
            .queued(move |s| {
                let saved = s.read(SAVED_SESSION)?;
                if saved
                    .and_then(|v| parse_saved(&v))
                    .is_some_and(|(saved_id, _)| saved_id == id)
                {
                    s.clear(SAVED_SESSION)?;
                }
                Ok(())
            })
            .await;
    }

    /// Stores `cookies` under a new id; None when no random id could be made.
    fn insert(&self, cookies: String) -> Option<String> {
        let id = new_session_id()?;
        let _ = self.map.lock().ok()?.insert(id.clone(), cookies);
        Some(id)
    }

    /// The cookies stored under `id`.
    fn get(&self, id: &str) -> Option<String> {
        self.map.lock().ok()?.get(id).cloned()
    }

    /// Forgets `id`.
    fn remove(&self, id: &str) {
        if let Ok(mut map) = self.map.lock() {
            let _ = map.remove(id);
        }
    }
}

/// The `(id, cookies)` in a saved session, or None when it is not one.
fn parse_saved(saved: &str) -> Option<(String, String)> {
    let v: Value = serde_json::from_str(saved).ok()?;
    let id = v.get("id")?.as_str()?.to_owned();
    let cookies = v.get("cookies")?.as_str()?.to_owned();
    (!id.is_empty() && !cookies.is_empty()).then_some((id, cookies))
}

/// A version-4 UUID, lowercase, from 16 random bytes.
#[must_use]
pub fn format_uuid_v4(mut bytes: [u8; 16]) -> String {
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let mut out = String::with_capacity(36);
    for (i, byte) in bytes.iter().enumerate() {
        if matches!(i, 4 | 6 | 8 | 10) {
            out.push('-');
        }
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// A fresh random session id.
fn new_session_id() -> Option<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).ok()?;
    Some(format_uuid_v4(bytes))
}

/// `cookies` plus the first `name=value` of a `set-cookie` header, as `cookiesLogin` does.
#[must_use]
pub fn with_socket_cookie(cookies: &str, set_cookie: Option<&str>) -> String {
    match set_cookie.and_then(|v| v.split(';').next()).map(str::trim) {
        Some(extra) if !extra.is_empty() => format!("{cookies}; {extra}"),
        _ => cookies.to_owned(),
    }
}

/// Where output.pdf is downloaded from.
#[derive(Debug, PartialEq, Eq)]
pub enum PdfSource {
    /// The compile's CDN, fetched without cookies.
    Cdn(String),
    /// Overleaf itself, fetched with the session cookies.
    Overleaf(String),
}

/// output.pdf's address from a compile reply, or the message the page shows.
pub fn pdf_source(compile: &Value) -> Result<PdfSource, String> {
    let text = |key: &str| compile.get(key).and_then(Value::as_str);
    let status = text("status").unwrap_or_default();
    if status != "success" {
        return Err(format!("Compile failed (status {status})."));
    }
    let url = compile
        .get("outputFiles")
        .and_then(Value::as_array)
        .and_then(|files| {
            files
                .iter()
                .find(|f| f.get("path").and_then(Value::as_str) == Some("output.pdf"))
        })
        .and_then(|f| f.get("url").and_then(Value::as_str))
        .ok_or_else(|| "The compile produced no PDF.".to_owned())?;
    Ok(match (text("pdfDownloadDomain"), text("clsiServerId")) {
        (Some(domain), Some(server)) if !domain.is_empty() && !server.is_empty() => {
            PdfSource::Cdn(cdn_pdf_url(
                domain,
                url,
                text("compileGroup").unwrap_or_default(),
                server,
            ))
        }
        _ => PdfSource::Overleaf(format!("{BASE}{}", url.trim_start_matches('/'))),
    })
}

/// The session cookies and the CSRF token a signed-in request carries.
struct Identity {
    cookies: String,
    csrf: String,
}

/// Sends `request`, retrying 5xx, 429 and network failures twice.
async fn send(request: reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
    let mut delays = RETRY_DELAYS_MS.iter();
    loop {
        let attempt = request
            .try_clone()
            .ok_or_else(|| "The Overleaf request could not be sent.".to_owned())?;
        let result = attempt.send().await;
        let retry = match &result {
            Ok(r) => r.status().is_server_error() || r.status().as_u16() == 429,
            Err(_) => true,
        };
        if retry && let Some(ms) = delays.next() {
            tokio::time::sleep(Duration::from_millis(*ms)).await;
            continue;
        }
        return result.map_err(|e| e.to_string());
    }
}

/// The body as text, up to `MAX_TEXT`.
async fn text(response: reqwest::Response) -> Result<String, String> {
    match read_capped(response, MAX_TEXT).await {
        Ok(Some(bytes)) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
        _ => Err("The Overleaf reply could not be read.".to_owned()),
    }
}

/// The JSON body of a 200 or 204 reply; any other status is `"<status>: <body>"`.
async fn ok_json(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status().as_u16();
    let body = text(response).await?;
    if status != 200 && status != 204 {
        return Err(format!("{status}: {body}"));
    }
    serde_json::from_str(&body).map_err(|e| e.to_string())
}

/// Signs in with a session cookie: reads the CSRF token from the project page, then picks up the socket cookie.
async fn login(client: &reqwest::Client, cookies: &str) -> Result<Identity, String> {
    let page = send(
        client
            .get(format!("{BASE}project"))
            .header("connection", "keep-alive")
            .header("cookie", cookies),
    )
    .await?;
    let meta = parse_overleaf_meta(&text(page).await?).ok_or("Failed to get User ID.")?;
    let socket = client
        .get(format!("{BASE}socket.io/socket.io.js"))
        .header("cookie", cookies)
        .send()
        .await
        .ok();
    let set_cookie = socket
        .as_ref()
        .and_then(|r| r.headers().get("set-cookie"))
        .and_then(|v| v.to_str().ok());
    Ok(Identity {
        cookies: with_socket_cookie(cookies, set_cookie),
        csrf: meta.csrf_token,
    })
}

/// The user's projects as `{id, name}`.
async fn list_projects(client: &reqwest::Client, cookies: &str) -> Result<Vec<Value>, String> {
    let who = login(client, cookies).await?;
    let request = client
        .get(format!("{BASE}user/projects"))
        .header("cookie", &who.cookies);
    let listed = ok_json(send(request).await?).await?;
    let projects = listed
        .get("projects")
        .and_then(Value::as_array)
        .ok_or("Overleaf projects could not be listed.")?;
    Ok(projects
        .iter()
        .map(|p| json!({ "id": p.get("_id").or_else(|| p.get("id")), "name": p.get("name") }))
        .collect())
}

/// Signs in and compiles; a LaTeX failure is data (status "failure").
/// With no `root`, Overleaf compiles the project's main document.
async fn compile(
    client: &reqwest::Client,
    cookies: &str,
    project: &str,
    root: Option<&str>,
) -> Result<(Identity, Value), String> {
    let who = login(client, cookies).await?;
    let mut body = json!({
        "_csrf": who.csrf, "check": "silent", "draft": false, "incrementalCompilesEnabled": true,
        "stopOnFirstError": false,
    });
    if let Some(root) = root {
        body["rootResourcePath"] = json!(root);
    }
    let request = client
        .post(format!("{BASE}project/{project}/compile?auto_compile=true"))
        .header("cookie", &who.cookies)
        .header("x-csrf-token", &who.csrf)
        .header("content-type", "application/json")
        .body(body.to_string());
    let reply = ok_json(send(request).await?).await?;
    if reply.get("status").and_then(Value::as_str).is_none() {
        return Err("Overleaf compile request failed.".to_owned());
    }
    Ok((who, reply))
}

/// Compiles, then downloads output.pdf.
async fn fetch_pdf(
    client: &reqwest::Client,
    cookies: &str,
    project: &str,
    root: Option<&str>,
) -> Result<Vec<u8>, String> {
    let (who, reply) = compile(client, cookies, project, root).await?;
    let request = match pdf_source(&reply)? {
        PdfSource::Cdn(url) => client.get(url),
        PdfSource::Overleaf(url) => client.get(url).header("cookie", &who.cookies),
    };
    let failed = || "The PDF could not be downloaded.".to_owned();
    let response = send(request).await.map_err(|_| failed())?;
    if response.status().as_u16() != 200 {
        return Err(failed());
    }
    match read_capped(response, MAX_PDF).await {
        Ok(Some(bytes)) if !bytes.is_empty() => Ok(bytes),
        _ => Err(failed()),
    }
}

/// A JSON answer; `no_store` adds `Cache-Control: no-store`.
fn json_answer(status: u16, body: &Value, no_store: bool) -> Answer {
    let mut headers = vec![("content-type".to_owned(), "application/json".to_owned())];
    if no_store {
        headers.push(("cache-control".to_owned(), "no-store".to_owned()));
    }
    Answer {
        status,
        headers,
        body: body.to_string().into_bytes(),
    }
}

/// `{error}` with `status`.
fn error(status: u16, message: &str) -> Answer {
    json_answer(status, &json!({ "error": message }), false)
}

/// The request body as JSON, or the 400 the hosted routes give.
fn parse_body(body: &[u8]) -> Result<Value, Answer> {
    serde_json::from_slice(body).map_err(|e| error(400, &format!("Invalid JSON body: {e}")))
}

/// POST session: verifies the cookie, keeps it, and answers only its id.
async fn sign_in(client: &reqwest::Client, sessions: &WorkshopSessions, body: &[u8]) -> Answer {
    let body = match parse_body(body) {
        Ok(v) => v,
        Err(answer) => return answer,
    };
    let cookies = body
        .get("cookies")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if cookies.is_empty() {
        return error(400, "An Overleaf session cookie is required.");
    }
    match start_session(client, sessions, cookies).await {
        Ok(id) => json_answer(201, &json!({ "sessionId": id }), true),
        Err((status, message)) => error(status, &message),
    }
}

/// Verifies the cookie with Overleaf and keeps it, answering only the new session id.
/// Shared by the paste route and the in-app sign-in window (`overleaf_signin`).
///
/// # Errors
/// The HTTP status and a message with the cookie redacted: 401 when Overleaf refuses it,
/// 502 when it cannot be stored.
pub(crate) async fn start_session(
    client: &reqwest::Client,
    sessions: &WorkshopSessions,
    cookies: &str,
) -> Result<String, (u16, String)> {
    if let Err(message) = login(client, cookies).await {
        return Err((401, safe_overleaf_error(&message, Some(cookies))));
    }
    let id = sessions
        .insert(cookies.to_owned())
        .ok_or_else(|| (502, "The Overleaf session could not be stored.".to_owned()))?;
    sessions.save(&id, cookies).await;
    Ok(id)
}

/// DELETE session?id=…: forgets the session, here and in the keychain.
async fn sign_out(sessions: &WorkshopSessions, query: Option<&str>) -> Answer {
    let id = query
        .and_then(|q| reqwest::Url::parse(&format!("http://x/?{q}")).ok())
        .and_then(|u| {
            u.query_pairs()
                .find(|(k, _)| k == "id")
                .map(|(_, v)| v.trim().to_owned())
        })
        .unwrap_or_default();
    if id.is_empty() {
        return error(400, "Session id required.");
    }
    sessions.sign_out(&id).await;
    json_answer(200, &json!({ "ok": true }), false)
}

/// POST projects: the session's project list.
async fn projects(client: &reqwest::Client, sessions: &WorkshopSessions, body: &[u8]) -> Answer {
    let id = match parse_body(body).map(|b| read_workshop_session_id(&b)) {
        Ok(Ok(id)) => id,
        Ok(Err(message)) => return error(400, message),
        Err(answer) => return answer,
    };
    let Some(cookies) = sessions.get(&id) else {
        return json_answer(401, &json!({ "error": NOT_FOUND, "expired": true }), false);
    };
    match list_projects(client, &cookies).await {
        Ok(list) => json_answer(200, &json!({ "projects": list }), true),
        Err(message) => error(502, &safe_overleaf_error(&message, Some(&cookies))),
    }
}

/// POST compile or pdf: the compile status and files, or the PDF bytes.
async fn compile_route(
    client: &reqwest::Client,
    sessions: &WorkshopSessions,
    body: &[u8],
    want_pdf: bool,
) -> Answer {
    let req = match parse_body(body).map(|b| read_workshop_request(&b)) {
        Ok(Ok(req)) => req,
        Ok(Err(message)) => return error(400, message),
        Err(answer) => return answer,
    };
    let Some(cookies) = sessions.get(&req.session_id) else {
        return error(401, NOT_FOUND);
    };
    let (project, root) = (&req.project_id, req.root_resource_path.as_deref());
    let result = if want_pdf {
        fetch_pdf(client, &cookies, project, root)
            .await
            .map(|pdf| Answer {
                status: 200,
                headers: vec![
                    ("content-type".to_owned(), "application/pdf".to_owned()),
                    ("cache-control".to_owned(), "no-store".to_owned()),
                ],
                body: pdf,
            })
    } else {
        compile(client, &cookies, project, root).await.map(|(_, reply)| {
            let body = json!({ "status": reply.get("status"), "outputFiles": reply.get("outputFiles") });
            json_answer(200, &body, true)
        })
    };
    result.unwrap_or_else(|message| error(502, &safe_overleaf_error(&message, Some(&cookies))))
}

/// The answer to one Workshop request; `path` starts with `PREFIX`.
pub async fn serve(
    client: &reqwest::Client,
    sessions: &WorkshopSessions,
    method: &str,
    path: &str,
    query: Option<&str>,
    body: &[u8],
) -> Answer {
    let action = path.strip_prefix(PREFIX).unwrap_or_default();
    match (method, action) {
        ("POST", "session") => sign_in(client, sessions, body).await,
        ("DELETE", "session") => sign_out(sessions, query).await,
        ("POST", "projects") => projects(client, sessions, body).await,
        ("POST", "compile") => compile_route(client, sessions, body, false).await,
        ("POST", "pdf") => compile_route(client, sessions, body, true).await,
        (_, "session" | "projects" | "compile" | "pdf") => error(405, "Method not allowed."),
        _ => error(404, "Not found."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "00000000-0000-4000-8000-000000000000";

    fn body_json(answer: &Answer) -> Value {
        serde_json::from_slice(&answer.body).unwrap()
    }

    async fn call(
        sessions: &WorkshopSessions,
        method: &str,
        path: &str,
        query: Option<&str>,
        body: &str,
    ) -> Answer {
        let client = reqwest::Client::new();
        serve(
            &client,
            sessions,
            method,
            &format!("{PREFIX}{path}"),
            query,
            body.as_bytes(),
        )
        .await
    }

    #[test]
    fn uuid_is_v4_shaped() {
        let id = format_uuid_v4([0xff; 16]);
        assert_eq!(id, "ffffffff-ffff-4fff-bfff-ffffffffffff");
        assert_eq!(format_uuid_v4([0; 16]), ID);
        let fresh = new_session_id().unwrap();
        assert_eq!(fresh.len(), 36);
        assert_eq!(fresh.chars().nth(14), Some('4'));
    }

    #[test]
    fn socket_cookie_appends_first_pair_only() {
        assert_eq!(
            with_socket_cookie("a=1", Some("GCLB=x; Path=/; HttpOnly")),
            "a=1; GCLB=x"
        );
        assert_eq!(with_socket_cookie("a=1", Some("")), "a=1");
        assert_eq!(with_socket_cookie("a=1", None), "a=1");
    }

    #[test]
    fn pdf_source_prefers_the_cdn() {
        let reply = json!({
            "status": "success", "compileGroup": "standard", "clsiServerId": "clsi-1",
            "pdfDownloadDomain": "https://compiles.overleafusercontent.com",
            "outputFiles": [{ "path": "output.log", "url": "/x.log" }, { "path": "output.pdf", "url": "/project/p/build/b/output/output.pdf" }],
        });
        assert!(
            matches!(pdf_source(&reply), Ok(PdfSource::Cdn(url)) if url.starts_with("https://compiles.overleafusercontent.com"))
        );
    }

    #[test]
    fn pdf_source_falls_back_to_overleaf() {
        let reply = json!({ "status": "success", "outputFiles": [{ "path": "output.pdf", "url": "/project/p/output.pdf" }] });
        assert_eq!(
            pdf_source(&reply),
            Ok(PdfSource::Overleaf(
                "https://www.overleaf.com/project/p/output.pdf".to_owned()
            ))
        );
    }

    #[test]
    fn pdf_source_reports_failures() {
        assert_eq!(
            pdf_source(&json!({ "status": "failure" })),
            Err("Compile failed (status failure).".to_owned())
        );
        let none = json!({ "status": "success", "outputFiles": [] });
        assert_eq!(
            pdf_source(&none),
            Err("The compile produced no PDF.".to_owned())
        );
    }

    #[test]
    fn sessions_store_get_and_forget() {
        let sessions = WorkshopSessions::default();
        let id = sessions.insert("a=1".to_owned()).unwrap();
        assert_eq!(sessions.get(&id).as_deref(), Some("a=1"));
        sessions.remove(&id);
        assert_eq!(sessions.get(&id), None);
    }

    fn keychain() -> crate::secrets::Secrets {
        crate::secrets::Secrets::new(Some(keyring_core::mock::Store::new().unwrap()), "test")
    }

    #[tokio::test]
    async fn saved_session_survives_a_restart_until_sign_out() {
        let secrets = keychain();
        let first = WorkshopSessions::remembered(secrets.clone());
        let id = first.insert("a=1".to_owned()).unwrap();
        first.save(&id, "a=1").await;
        let stored = secrets.read(SAVED_SESSION).unwrap().unwrap();
        assert_eq!(parse_saved(&stored), Some((id.clone(), "a=1".to_owned())));

        let restarted = WorkshopSessions::remembered(secrets.clone());
        assert_eq!(restarted.get(&id).as_deref(), Some("a=1"));

        restarted.sign_out(ID).await;
        assert!(
            secrets.read(SAVED_SESSION).unwrap().is_some(),
            "another id keeps it"
        );
        restarted.sign_out(&id).await;
        assert_eq!(restarted.get(&id), None);
        assert_eq!(secrets.read(SAVED_SESSION).unwrap(), None);
        assert_eq!(WorkshopSessions::remembered(secrets).get(&id), None);
    }

    #[test]
    fn saved_session_must_have_both_fields() {
        assert_eq!(parse_saved("not json"), None);
        assert_eq!(parse_saved(r#"{"id":"x"}"#), None);
        assert_eq!(parse_saved(r#"{"id":"","cookies":"a=1"}"#), None);
        assert_eq!(
            parse_saved(r#"{"id":"x","cookies":"a=1"}"#),
            Some(("x".to_owned(), "a=1".to_owned()))
        );
    }

    #[tokio::test]
    async fn sign_in_needs_json_and_a_cookie() {
        let sessions = WorkshopSessions::default();
        let bad = call(&sessions, "POST", "session", None, "{").await;
        assert_eq!(bad.status, 400);
        assert!(
            body_json(&bad)["error"]
                .as_str()
                .unwrap()
                .starts_with("Invalid JSON body: ")
        );
        let empty = call(&sessions, "POST", "session", None, r#"{"cookies":"  "}"#).await;
        assert_eq!(empty.status, 400);
        assert_eq!(
            body_json(&empty)["error"],
            "An Overleaf session cookie is required."
        );
    }

    #[tokio::test]
    async fn sign_out_needs_an_id() {
        let sessions = WorkshopSessions::default();
        let id = sessions.insert("a=1".to_owned()).unwrap();
        assert_eq!(
            body_json(&call(&sessions, "DELETE", "session", None, "").await)["error"],
            "Session id required."
        );
        let ok = call(
            &sessions,
            "DELETE",
            "session",
            Some(&format!("id={id}")),
            "",
        )
        .await;
        assert_eq!((ok.status, body_json(&ok)), (200, json!({ "ok": true })));
        assert_eq!(sessions.get(&id), None);
    }

    #[tokio::test]
    async fn unknown_sessions_get_401() {
        let sessions = WorkshopSessions::default();
        let listed = call(
            &sessions,
            "POST",
            "projects",
            None,
            &format!(r#"{{"sessionId":"{ID}"}}"#),
        )
        .await;
        assert_eq!(
            (listed.status, body_json(&listed)),
            (401, json!({ "error": NOT_FOUND, "expired": true }))
        );
        let req =
            format!(r#"{{"sessionId":"{ID}","projectId":"abc123","rootResourcePath":"main.tex"}}"#);
        for path in ["compile", "pdf"] {
            let answer = call(&sessions, "POST", path, None, &req).await;
            assert_eq!(
                (answer.status, body_json(&answer)),
                (401, json!({ "error": NOT_FOUND })),
                "{path}"
            );
        }
    }

    #[tokio::test]
    async fn bad_requests_get_400() {
        let sessions = WorkshopSessions::default();
        assert_eq!(
            call(&sessions, "POST", "projects", None, "{}").await.status,
            400
        );
        assert_eq!(
            call(&sessions, "POST", "compile", None, r#"{"sessionId":"x"}"#)
                .await
                .status,
            400
        );
    }

    #[tokio::test]
    async fn unknown_paths_and_methods() {
        let sessions = WorkshopSessions::default();
        assert_eq!(
            call(&sessions, "GET", "projects", None, "").await.status,
            405
        );
        assert_eq!(call(&sessions, "POST", "nope", None, "").await.status, 404);
    }
}
