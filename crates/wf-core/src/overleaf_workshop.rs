//! Overleaf Workshop rules: request body checks, error redaction, project page meta and CDN URLs.

use serde_json::Value;

/// Message for a missing or malformed session id.
pub const SESSION_ID_INVALID: &str =
    "A valid Overleaf session id is required. Sign in to Overleaf first.";
/// Message for a body that is neither an object nor an array.
pub const BODY_REQUIRED: &str = "A JSON body is required.";
/// Message for a missing or malformed project id.
pub const PROJECT_ID_INVALID: &str = "A valid Overleaf project id is required.";
/// Message for a root `.tex` path that is not text.
pub const ROOT_INVALID: &str = "The root .tex file must be a text path.";

/// Replacement for a secret in error text.
const REDACTED: &str = "[redacted]";
/// Replacement for a URL that does not parse.
const REDACTED_URL: &str = "[redacted-url]";
/// Longest error text kept, in characters.
const MAX_ERROR_CHARS: usize = 500;

/// Validated Workshop request body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkshopRequest {
    /// Overleaf session id, as sent.
    pub session_id: String,
    /// Overleaf project id, ASCII alphanumeric.
    pub project_id: String,
    /// Root `.tex` path, trimmed. `None` lets Overleaf use the project's main document.
    pub root_resource_path: Option<String>,
}

/// Overleaf user and CSRF values scraped from the project page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverleafMeta {
    /// Content of `ol-user_id`.
    pub user_id: String,
    /// Content of `ol-usersEmail`, empty when absent.
    pub user_email: String,
    /// Content of `ol-csrfToken`.
    pub csrf_token: String,
}

/// Validates a Workshop request body. Checks run in order: body, session, project, root.
pub fn read_workshop_request(body: &Value) -> Result<WorkshopRequest, &'static str> {
    if !(body.is_object() || body.is_array()) {
        return Err(BODY_REQUIRED);
    }
    let session_id = session_id_field(body).ok_or(SESSION_ID_INVALID)?;
    let project_id = match body.get("projectId").and_then(Value::as_str) {
        Some(id) if is_project_id(id) => id.to_owned(),
        _ => return Err(PROJECT_ID_INVALID),
    };
    let root = match body.get("rootResourcePath") {
        None | Some(Value::Null) => None,
        Some(Value::String(root)) => Some(root.trim()).filter(|root| !root.is_empty()),
        Some(_) => return Err(ROOT_INVALID),
    };
    Ok(WorkshopRequest {
        session_id,
        project_id,
        root_resource_path: root.map(str::to_owned),
    })
}

/// Validates a body that carries only a session id.
pub fn read_workshop_session_id(body: &Value) -> Result<String, &'static str> {
    session_id_field(body).ok_or(SESSION_ID_INVALID)
}

/// Removes the secret and credentials from URLs in an error, then keeps the first 500 characters.
#[must_use]
pub fn safe_overleaf_error(raw: &str, secret: Option<&str>) -> String {
    let unsecret = match secret {
        Some(token) if !token.is_empty() => raw.replace(token, REDACTED),
        _ => raw.to_owned(),
    };
    redact_urls(&unsecret)
        .chars()
        .take(MAX_ERROR_CHARS)
        .collect()
}

/// Reads the user id, email and CSRF token from the project page. `None` unless user id and CSRF match.
#[must_use]
pub fn parse_overleaf_meta(html: &str) -> Option<OverleafMeta> {
    let user_id = meta_content(html, "ol-user_id")?;
    let csrf_token = meta_content(html, "ol-csrfToken")?;
    let user_email = meta_content(html, "ol-usersEmail").unwrap_or_default();
    Some(OverleafMeta {
        user_id,
        user_email,
        csrf_token,
    })
}

/// Percent-encodes like JS `encodeURIComponent`.
#[must_use]
pub fn encode_uri_component(input: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(input.len());
    for &byte in input.as_bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push('%');
            out.push(char::from(HEX[usize::from(byte >> 4)]));
            out.push(char::from(HEX[usize::from(byte & 0x0F)]));
        }
    }
    out
}

/// CDN URL for a compiled PDF, with the same slash trimming and query as the TypeScript.
#[must_use]
pub fn cdn_pdf_url(domain: &str, url: &str, group: &str, server: &str) -> String {
    format!(
        "{}/{}?compileGroup={}&clsiserverid={}&enable_pdf_caching=true",
        domain.trim_end_matches('/'),
        url.trim_start_matches('/'),
        encode_uri_component(group),
        encode_uri_component(server),
    )
}

/// Session id as a string when `body.sessionId` is a valid UUID.
fn session_id_field(body: &Value) -> Option<String> {
    body.get("sessionId")
        .and_then(Value::as_str)
        .filter(|id| is_session_id(id))
        .map(str::to_owned)
}

/// UUID shape, case-insensitive hex, no surrounding whitespace.
fn is_session_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => *b == b'-',
            _ => b.is_ascii_hexdigit(),
        })
}

/// Non-empty ASCII alphanumeric project id.
fn is_project_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// Captured content of `<meta name="{name}" content="...">`.
fn meta_content(html: &str, name: &str) -> Option<String> {
    let pattern = format!(r#"<meta\s+name="{name}"\s+content="([^"]*)">"#);
    let re = regex_lite::Regex::new(&pattern).ok()?;
    re.captures(html)?.get(1).map(|m| m.as_str().to_owned())
}

/// Replaces every `https?://` run of non-space characters with its credential-free form.
fn redact_urls(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = find_url_start(rest) {
        let (before, from) = rest.split_at(start);
        out.push_str(before);
        let end = from.find(is_js_space).unwrap_or(from.len());
        out.push_str(&redact_url(&from[..end]));
        rest = &from[end..];
    }
    out.push_str(rest);
    out
}

/// Byte index of the first URL start followed by a non-space character.
fn find_url_start(text: &str) -> Option<usize> {
    text.char_indices().find_map(|(i, _)| {
        let tail = text.get(i..)?;
        let scheme_len = if starts_with_ci(tail, "https://") {
            8
        } else if starts_with_ci(tail, "http://") {
            7
        } else {
            return None;
        };
        let next = tail.get(scheme_len..)?.chars().next()?;
        (!is_js_space(next)).then_some(i)
    })
}

/// Case-insensitive ASCII prefix test.
fn starts_with_ci(text: &str, prefix: &str) -> bool {
    text.get(..prefix.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
}

/// Whitespace as JS `\s` sees it, so the scan matches the TypeScript regex.
fn is_js_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

/// URL with username and password removed, or the redacted marker when it does not parse.
fn redact_url(candidate: &str) -> String {
    match url::Url::parse(candidate) {
        Ok(mut parsed) => {
            let _user = parsed.set_username("");
            let _password = parsed.set_password(None);
            parsed.to_string()
        }
        Err(_) => REDACTED_URL.to_owned(),
    }
}
