//! Port of the pure rules in `apps/shell/sidecar/src/app-protocol.ts`: turning an
//! `app://` request into candidate files inside the bundle, refusing what is not
//! one, the content types, and the headers each response carries. Asking the
//! disk which candidate exists, and the protocol handler itself, stay in TS.

use serde_json::{Map, Value};

/// The policy every HTML response carries. Its entries and why they are there
/// are recorded in `apps/shell/sidecar/src/app-protocol.ts`, next to the copy
/// this must match.
pub const APP_CSP: &str = concat!(
    "default-src 'self'; ",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; ",
    "style-src 'self' 'unsafe-inline'; ",
    "img-src 'self' app://artifacts data: blob: https:; ",
    "font-src 'self' data:; ",
    "connect-src 'self' app: cache: https: wss: http://localhost:* http://127.0.0.1:*; ",
    "worker-src 'self' blob:; ",
    "media-src 'self' blob: https:; ",
    "frame-src 'self' blob:; ",
    "object-src 'none'; ",
    "frame-ancestors 'none'; ",
    "base-uri 'self'; ",
    "form-action 'self'",
);

/// The headers a response carries. The policy is added only to HTML, because a
/// script or an image has no policy to carry.
#[must_use]
pub fn app_headers(content_type: &str) -> Map<String, Value> {
    let mut headers = Map::new();
    let _ = headers.insert(
        "content-type".to_owned(),
        Value::String(content_type.to_owned()),
    );
    let _ = headers.insert(
        "x-content-type-options".to_owned(),
        Value::String("nosniff".to_owned()),
    );
    let _ = headers.insert(
        "referrer-policy".to_owned(),
        Value::String("strict-origin-when-cross-origin".to_owned()),
    );
    if content_type.starts_with("text/html") {
        let _ = headers.insert(
            "content-security-policy".to_owned(),
            Value::String(APP_CSP.to_owned()),
        );
    }
    headers
}

/// The content type for a file, by extension. Unknown means bytes.
#[must_use]
pub fn content_type_for(file: &str) -> &'static str {
    let name = file.rsplit(['/', '\\']).next().unwrap_or(file);
    let ext = name
        .rfind('.')
        .filter(|index| *index > 0)
        .and_then(|index| name.get(index..))
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        ".html" => "text/html; charset=utf-8",
        ".js" | ".mjs" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" | ".map" => "application/json; charset=utf-8",
        ".webmanifest" => "application/manifest+json; charset=utf-8",
        ".txt" => "text/plain; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" | ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".ico" => "image/x-icon",
        ".woff" => "font/woff",
        ".woff2" => "font/woff2",
        ".ttf" => "font/ttf",
        ".wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

/// The URL with repeated slashes in its path collapsed, or `None` when the path
/// is already clean or the URL does not parse. The query and fragment are left alone.
#[must_use]
pub fn canonical_app_url(request_url: &str) -> Option<String> {
    let mut url = url::Url::parse(request_url).ok()?;
    let path = url.path().to_owned();
    let collapsed = collapse_slashes(&path);
    if collapsed == path {
        return None;
    }
    url.set_path(&collapsed);
    Some(url.to_string())
}

/// Whether a missed request was for a page rather than an asset: its last
/// segment has no extension, or is `.html`.
#[must_use]
pub fn is_page_request(request_url: &str) -> bool {
    let Some(path) = request_path(request_url) else {
        return false;
    };
    let last = path
        .split('/')
        .rfind(|segment| !segment.is_empty())
        .unwrap_or("");
    !last.contains('.') || last.ends_with(".html")
}

/// The files a request may be served from, in the order to try them, or `None`
/// when the request is not a path inside `root`.
///
/// `root` is the bundle folder, already normalised (no trailing separator).
/// `sep` is the platform separator. The caller keeps the first candidate that
/// exists as a file: a folder is never a candidate itself, so `/reader` tries
/// `reader`, `reader.html`, `reader/index.html` and the segment file, in that order.
/// A request ending in `/` gets only `index.html` inside that folder.
///
/// `\` counts as a separator on every platform, which is stricter than Node's
/// POSIX `path.join`.
#[must_use]
pub fn app_file_candidates(root: &str, request_url: &str, sep: char) -> Option<Vec<String>> {
    let path = request_path(request_url)?;
    let relative = decode_percent(&path)?;
    let joined = join_under(root, &relative, sep)?;
    if relative.ends_with('/') {
        return Some(vec![child(&joined, "index.html", sep)]);
    }
    let mut candidates = vec![
        joined.clone(),
        format!("{joined}.html"),
        child(&joined, "index.html", sep),
    ];
    candidates.extend(segment_file(&joined, sep));
    Some(candidates)
}

/// The pathname of a URL that parses, still percent-encoded.
fn request_path(request_url: &str) -> Option<String> {
    url::Url::parse(request_url)
        .ok()
        .map(|url| url.path().to_owned())
}

/// Collapses each run of `/` to one.
fn collapse_slashes(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    let mut after_slash = false;
    for ch in path.chars() {
        if ch == '/' {
            if after_slash {
                continue;
            }
            after_slash = true;
        } else {
            after_slash = false;
        }
        out.push(ch);
    }
    out
}

/// Percent-decodes a path the way `decodeURIComponent` does. `None` for a
/// malformed escape or bytes that are not UTF-8.
fn decode_percent(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while let Some(&byte) = bytes.get(index) {
        if byte == b'%' {
            let high = hex_value(*bytes.get(index + 1)?)?;
            let low = hex_value(*bytes.get(index + 2)?)?;
            out.push((high << 4) | low);
            index += 3;
        } else {
            out.push(byte);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Joins a decoded request path onto `root` the way `path.join` does: `.` and
/// empty parts drop out, `..` climbs, and a `..` that would leave `root` is `None`.
/// A leading `/` in the request is only a separator, so it cannot replace `root`.
fn join_under(root: &str, relative: &str, sep: char) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();
    for part in relative.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => {
                let _ = parts.pop()?;
            }
            other => parts.push(other),
        }
    }
    let base = root.trim_end_matches(['/', '\\']);
    if parts.is_empty() {
        return Some(if base.is_empty() {
            sep.to_string()
        } else {
            base.to_owned()
        });
    }
    let mut joined = base.to_owned();
    for part in parts {
        joined.push(sep);
        joined.push_str(part);
    }
    Some(joined)
}

/// `dir` with `name` added as its last segment.
fn child(dir: &str, name: &str, sep: char) -> String {
    format!("{}{sep}{name}", dir.trim_end_matches(['/', '\\']))
}

/// Where the export put a segment prefetch the client names with dots:
/// `__next.plan.__PAGE__.txt` is written as `__next.plan/__PAGE__.txt`.
/// `None` when `joined` is not such a file.
fn segment_file(joined: &str, sep: char) -> Option<String> {
    let (dir, base) = joined.rsplit_once(['/', '\\'])?;
    let rest_of = base.strip_prefix("__next.")?;
    let (first, tail) = rest_of.split_once('.')?;
    let rest = tail.strip_suffix(".txt")?;
    if first.is_empty() || rest.is_empty() {
        return None;
    }
    let relative = format!("__next.{first}/{}.txt", rest.replace('.', "/"));
    join_under(dir, &relative, sep)
}
