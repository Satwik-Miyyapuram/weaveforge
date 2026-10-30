//! Serving the bundled web export to the window over a custom scheme.
//!
//! Port of `apps/desktop/src/app-protocol.ts`. Functions take the request path
//! (what `http::Uri::path()` returns), not a full URL, because the scheme's URL
//! differs per OS.

use std::path::{Path, PathBuf};

/// The scheme the window is served on.
pub const APP_SCHEME: &str = "app";

/// Hosts the window is served from: `localhost` (Linux, macOS) and `app.localhost` (Windows).
pub const APP_HOSTS: [&str; 2] = ["localhost", "app.localhost"];

/// Content-Security-Policy for HTML documents. Electron's policy, rewritten for the Tauri origins:
/// IPC is `ipc://localhost` (Linux, macOS) or `https://ipc.localhost` (Windows); models and
/// artifacts will be same-origin paths, so `app://…` and `cache:` are gone.
pub const APP_CSP: &str = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' ipc: https://ipc.localhost https: wss: http://localhost:* http://127.0.0.1:*; worker-src 'self' blob:; media-src 'self' blob: https:; frame-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/// One response: status, headers, body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    /// HTTP status code.
    pub status: u16,
    /// Header name/value pairs, names lowercase.
    pub headers: Vec<(&'static str, String)>,
    /// Response body.
    pub body: Vec<u8>,
}

/// Decodes `%XX` escapes as `decodeURIComponent` does; `None` on a bad escape or non-UTF-8.
#[must_use]
fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while let Some(&b) = bytes.get(i) {
        if b == b'%' {
            let hi = *bytes.get(i + 1)?;
            let lo = *bytes.get(i + 2)?;
            out.push(hex_pair(hi, lo)?);
            i += 3;
        } else {
            out.push(b);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Two ASCII hex digits as one byte.
#[must_use]
fn hex_pair(hi: u8, lo: u8) -> Option<u8> {
    let h = char::from(hi).to_digit(16)?;
    let l = char::from(lo).to_digit(16)?;
    u8::try_from(h * 16 + l).ok()
}

/// The file a request path names inside `root`, or `None` if nothing we have matches.
#[must_use]
pub fn resolve_app_file(
    root: &Path,
    path: &str,
    is_file: &dyn Fn(&Path) -> bool,
) -> Option<PathBuf> {
    let relative = percent_decode(path)?;
    let mut kept: Vec<&str> = Vec::new();
    for segment in relative.split(['/', '\\']) {
        match segment {
            "" | "." => {}
            // Leaving the root is refused by where the path ends up, not by spelling.
            ".." => {
                // Dropping the popped name; only whether there was one matters.
                let _ = kept.pop()?;
            }
            // Windows drive and stream prefixes, and NUL, never name a file here.
            s if s.contains([':', '\0']) => return None,
            // Windows trims these from names, so `..%20` would reach the parent.
            s if s.ends_with(['.', ' ']) => return None,
            s => kept.push(s),
        }
    }
    let mut joined = root.to_path_buf();
    for segment in &kept {
        joined.push(segment);
    }
    if !joined.starts_with(root) {
        return None;
    }
    let candidates = if kept.is_empty() || relative.ends_with('/') {
        vec![joined.join("index.html")]
    } else {
        let mut html = joined.clone().into_os_string();
        html.push(".html");
        let mut list = vec![
            joined.clone(),
            PathBuf::from(html),
            joined.join("index.html"),
        ];
        list.extend(segment_file(&joined));
        list
    };
    candidates.into_iter().find(|f| is_file(f))
}

/// The export's folder form of a dotted segment prefetch file, or `None`.
///
/// Next fetches `__next.plan.__PAGE__.txt`; the static export writes it as
/// `__next.plan/__PAGE__.txt`, so every dot after the first segment is a folder.
#[must_use]
fn segment_file(file: &Path) -> Option<PathBuf> {
    let name = file.file_name()?.to_str()?;
    let inner = name.strip_prefix("__next.")?.strip_suffix(".txt")?;
    let (first, rest) = inner.split_once('.')?;
    if first.is_empty() || rest.is_empty() {
        return None;
    }
    let mut out = file.parent()?.to_path_buf();
    out.push(format!("__next.{first}"));
    for piece in rest.split('.').filter(|p| !p.is_empty()) {
        out.push(piece);
    }
    let mut os = out.into_os_string();
    os.push(".txt");
    Some(PathBuf::from(os))
}

/// The path with runs of `/` collapsed, or `None` when it is already clean.
#[must_use]
pub fn canonical_path(path: &str) -> Option<String> {
    let mut out = String::with_capacity(path.len());
    let mut prev_slash = false;
    for c in path.chars() {
        if c == '/' && prev_slash {
            continue;
        }
        prev_slash = c == '/';
        out.push(c);
    }
    (out != path).then_some(out)
}

/// Whether a missed request was for a page rather than an asset.
#[must_use]
pub fn is_page_request(path: &str) -> bool {
    let last = path.split('/').rfind(|s| !s.is_empty()).unwrap_or("");
    !last.contains('.') || last.ends_with(".html")
}

/// The content type for a file, by extension.
#[must_use]
pub fn content_type_for(file: &Path) -> &'static str {
    let ext = file
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match ext.as_deref() {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json" | "map") => "application/json; charset=utf-8",
        Some("webmanifest") => "application/manifest+json; charset=utf-8",
        Some("txt") => "text/plain; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

/// The headers a bundle file is served with.
#[must_use]
pub fn app_headers(content_type: &str) -> Vec<(&'static str, String)> {
    let mut headers = vec![
        ("content-type", content_type.to_owned()),
        ("x-content-type-options", "nosniff".to_owned()),
        (
            "referrer-policy",
            "strict-origin-when-cross-origin".to_owned(),
        ),
    ];
    if content_type.starts_with("text/html") {
        headers.push(("content-security-policy", APP_CSP.to_owned()));
    }
    headers
}

/// The response for a request path, reading from `root` on disk.
#[must_use]
pub fn respond(root: &Path, host: Option<&str>, path: &str, query: Option<&str>) -> Reply {
    if !host.is_some_and(|h| APP_HOSTS.contains(&h)) {
        return not_found();
    }
    if path.starts_with("/api/") {
        return not_found();
    }
    if let Some(c) = canonical_path(path) {
        let location = match query {
            Some(q) if !q.is_empty() => format!("{c}?{q}"),
            _ => c,
        };
        return Reply {
            status: 308,
            headers: vec![("location", location)],
            body: Vec::new(),
        };
    }
    if let Some(file) = resolve_app_file(root, path, &|p: &Path| p.is_file()) {
        return match std::fs::read(&file) {
            Ok(body) => Reply {
                status: 200,
                headers: app_headers(content_type_for(&file)),
                body,
            },
            Err(_) => not_found(),
        };
    }
    if is_page_request(path)
        && let Ok(body) = std::fs::read(root.join("404.html"))
    {
        return Reply {
            status: 404,
            headers: app_headers("text/html; charset=utf-8"),
            body,
        };
    }
    not_found()
}

/// The bare 404 an asset miss or an unknown API path gets.
#[must_use]
fn not_found() -> Reply {
    Reply {
        status: 404,
        headers: app_headers("text/plain; charset=utf-8"),
        body: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn root() -> &'static Path {
        Path::new("/bundle")
    }

    /// Pushes each `/`-separated piece of `rel` onto `base`.
    fn join_pieces(base: &Path, rel: &str) -> PathBuf {
        let mut out = base.to_path_buf();
        for piece in rel.split('/') {
            out.push(piece);
        }
        out
    }

    fn fake_bundle() -> HashSet<PathBuf> {
        [
            "index.html",
            "settings/index.html",
            "_next/static/chunk.js",
            "icons/icon-512.png",
            "__next.__PAGE__.txt",
            "plan/__next._tree.txt",
            "plan/__next.plan/__PAGE__.txt",
        ]
        .iter()
        .map(|f| join_pieces(root(), f))
        .collect()
    }

    fn resolve(url: &str) -> Option<PathBuf> {
        let set = fake_bundle();
        resolve_app_file(root(), url, &|p: &Path| set.contains(p))
    }

    fn header<'a>(r: &'a Reply, name: &str) -> Option<&'a str> {
        r.headers
            .iter()
            .find(|(k, _)| *k == name)
            .map(|(_, v)| v.as_str())
    }

    /// Splits `APP_CSP` into the tokens of one directive.
    fn csp_tokens(directive: &str) -> Vec<&'static str> {
        APP_CSP
            .split(';')
            .map(str::trim)
            .find_map(|d| d.strip_prefix(directive))
            .unwrap_or("")
            .split(' ')
            .filter(|t| !t.is_empty())
            .collect()
    }

    fn temp_root(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("wf-shell-protocol-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn bundle_with_404(name: &str) -> PathBuf {
        let dir = temp_root(name);
        std::fs::write(dir.join("index.html"), "<p>home</p>").expect("write index");
        std::fs::write(dir.join("404.html"), "<p>lost</p>").expect("write 404");
        std::fs::write(dir.join("app.js"), "1").expect("write app.js");
        dir
    }

    #[test]
    fn root_is_index() {
        assert_eq!(resolve("/"), Some(join_pieces(root(), "index.html")));
    }

    #[test]
    fn directory_with_slash_lands_on_index() {
        assert_eq!(
            resolve("/settings/"),
            Some(join_pieces(root(), "settings/index.html"))
        );
    }

    #[test]
    fn directory_without_slash_lands_on_index() {
        assert_eq!(
            resolve("/settings"),
            Some(join_pieces(root(), "settings/index.html"))
        );
    }

    #[test]
    fn segment_prefetch_lands_on_export_folder() {
        assert_eq!(
            resolve("/plan/__next.plan.__PAGE__.txt"),
            Some(join_pieces(root(), "plan/__next.plan/__PAGE__.txt"))
        );
    }

    #[test]
    fn flat_segment_file_served_as_itself() {
        assert_eq!(
            resolve("/__next.__PAGE__.txt"),
            Some(join_pieces(root(), "__next.__PAGE__.txt"))
        );
        assert_eq!(
            resolve("/plan/__next._tree.txt"),
            Some(join_pieces(root(), "plan/__next._tree.txt"))
        );
    }

    #[test]
    fn asset_served_as_itself() {
        assert_eq!(
            resolve("/_next/static/chunk.js"),
            Some(join_pieces(root(), "_next/static/chunk.js"))
        );
    }

    #[test]
    fn escaped_path_is_decoded_before_lookup() {
        assert_eq!(
            resolve("/icons%2Ficon-512.png"),
            Some(join_pieces(root(), "icons/icon-512.png"))
        );
    }

    #[test]
    fn unknown_page_is_miss() {
        assert_eq!(resolve("/nowhere"), None);
    }

    #[test]
    fn traversal_out_of_bundle_refused() {
        assert_eq!(resolve("/../../etc/passwd"), None);
        assert_eq!(resolve("/settings/../../../secrets"), None);
    }

    #[test]
    fn traversal_inside_bundle_allowed() {
        assert_eq!(
            resolve("/a/../index.html"),
            Some(join_pieces(root(), "index.html"))
        );
    }

    #[test]
    fn encoded_separator_traversal_refused() {
        assert_eq!(resolve("/..%2F..%2Fsecrets"), None);
        assert_eq!(resolve("/..%5Csecrets"), None);
    }

    #[test]
    fn drive_prefix_refused() {
        assert_eq!(resolve("/C:%5Cwindows"), None);
    }

    #[test]
    fn nul_refused() {
        assert_eq!(resolve("/settings%00"), None);
    }

    #[test]
    fn malformed_escape_is_miss() {
        assert_eq!(resolve("/%E0%A4%A"), None);
    }

    #[test]
    fn percent_decode_utf8_ok() {
        assert_eq!(percent_decode("/caf%C3%A9"), Some("/café".to_string()));
    }

    #[test]
    fn percent_decode_invalid_utf8_none() {
        assert_eq!(percent_decode("/%FF"), None);
    }

    #[test]
    fn percent_decode_plus_is_literal() {
        assert_eq!(percent_decode("/a+b"), Some("/a+b".to_string()));
    }

    #[test]
    fn percent_decode_bare_percent_none() {
        assert_eq!(percent_decode("/%"), None);
        assert_eq!(percent_decode("/%G1"), None);
    }

    #[test]
    fn content_types_match_table_and_unknown_is_bytes() {
        assert_eq!(
            content_type_for(Path::new("/bundle/index.html")),
            "text/html; charset=utf-8"
        );
        assert_eq!(
            content_type_for(Path::new("/bundle/app.CSS")),
            "text/css; charset=utf-8"
        );
        assert_eq!(
            content_type_for(Path::new("/bundle/pglite.wasm")),
            "application/wasm"
        );
        assert_eq!(
            content_type_for(Path::new("/bundle/whatever.zzz")),
            "application/octet-stream"
        );
        assert_eq!(
            content_type_for(Path::new("/bundle/LICENSE")),
            "application/octet-stream"
        );
    }

    #[test]
    fn html_headers_include_csp() {
        let headers = app_headers("text/html; charset=utf-8");
        let get = |name: &str| {
            headers
                .iter()
                .find(|(k, _)| *k == name)
                .map(|(_, v)| v.clone())
        };
        assert_eq!(get("x-content-type-options").as_deref(), Some("nosniff"));
        assert_eq!(
            get("referrer-policy").as_deref(),
            Some("strict-origin-when-cross-origin")
        );
        assert_eq!(
            get("content-type").as_deref(),
            Some("text/html; charset=utf-8")
        );
        assert!(
            get("content-security-policy")
                .unwrap_or_default()
                .contains("frame-ancestors 'none'")
        );
    }

    #[test]
    fn script_headers_have_no_csp() {
        let headers = app_headers("text/javascript; charset=utf-8");
        assert!(headers.iter().all(|(k, _)| *k != "content-security-policy"));
    }

    #[test]
    fn connect_src_allows_ipc_and_web_sources() {
        let tokens = csp_tokens("connect-src ");
        for required in ["'self'", "ipc:", "https://ipc.localhost", "https:", "wss:"] {
            assert!(tokens.contains(&required), "missing {required}");
        }
    }

    #[test]
    fn csp_has_no_electron_only_sources() {
        for token in APP_CSP.split([' ', ';']) {
            assert_ne!(token, "cache:");
            assert_ne!(token, "app:");
            assert!(!token.starts_with("app://"), "electron source {token}");
        }
    }

    #[test]
    fn connect_src_has_no_bare_wildcards() {
        let tokens = csp_tokens("connect-src ");
        assert!(!tokens.contains(&"*"));
        assert!(tokens.iter().all(|t| !t.contains(":/*")));
        assert!(!tokens.contains(&"cache:*"));
    }

    #[test]
    fn frame_src_is_self_and_blob() {
        assert_eq!(csp_tokens("frame-src "), vec!["'self'", "blob:"]);
    }

    #[test]
    fn page_requests_are_told_apart_from_assets() {
        assert!(is_page_request("/org/"));
        assert!(is_page_request("/supervision"));
        assert!(is_page_request("/old.html"));
        assert!(!is_page_request("/_next/static/gone.js"));
        assert!(!is_page_request("/icons/missing.png"));
    }

    #[test]
    fn canonical_path_collapses_double_slashes() {
        assert_eq!(canonical_path("//"), Some("/".to_string()));
        assert_eq!(
            canonical_path("///notes//x/"),
            Some("/notes/x/".to_string())
        );
    }

    #[test]
    fn windows_trimmed_segments_refused() {
        assert_eq!(resolve("/..%20"), None);
        assert_eq!(resolve("/..%2e"), None);
        assert_eq!(resolve("/%5c..%5csecrets"), None);
        assert_eq!(resolve("/...."), None);
        assert_eq!(resolve("/x."), None);
        assert_eq!(resolve("/x%20"), None);
    }

    #[test]
    fn directory_with_trailing_slash_still_resolves() {
        assert_eq!(
            resolve("/settings/"),
            Some(join_pieces(root(), "settings/index.html"))
        );
    }

    #[test]
    fn canonical_path_clean_is_none() {
        assert_eq!(canonical_path("/"), None);
        assert_eq!(canonical_path("/notes/"), None);
    }

    #[test]
    fn respond_root_serves_index_with_csp() {
        let dir = bundle_with_404("root");
        let r = respond(&dir, Some("localhost"), "/", None);
        assert_eq!(r.status, 200);
        assert_eq!(r.body, b"<p>home</p>".to_vec());
        assert!(header(&r, "content-security-policy").is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn respond_script_has_js_type_and_no_csp() {
        let dir = bundle_with_404("script");
        let r = respond(&dir, Some("localhost"), "/app.js", None);
        assert_eq!(r.status, 200);
        assert_eq!(
            header(&r, "content-type"),
            Some("text/javascript; charset=utf-8")
        );
        assert!(header(&r, "content-security-policy").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn respond_double_slash_redirects_with_query() {
        let dir = bundle_with_404("redirect-query");
        let r = respond(&dir, Some("localhost"), "//notes//x/", Some("page=a//b"));
        assert_eq!(r.status, 308);
        assert_eq!(header(&r, "location"), Some("/notes/x/?page=a//b"));
        assert!(r.body.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn respond_double_slash_root_redirects() {
        let dir = bundle_with_404("redirect-root");
        let r = respond(&dir, Some("localhost"), "//", None);
        assert_eq!(r.status, 308);
        assert_eq!(header(&r, "location"), Some("/"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn respond_missing_page_serves_404_page() {
        let dir = bundle_with_404("missing-page");
        let r = respond(&dir, Some("localhost"), "/org/", None);
        assert_eq!(r.status, 404);
        assert_eq!(r.body, b"<p>lost</p>".to_vec());
        assert_eq!(header(&r, "content-type"), Some("text/html; charset=utf-8"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn respond_missing_asset_is_bare_404() {
        let dir = bundle_with_404("missing-asset");
        let r = respond(&dir, Some("localhost"), "/gone.js", None);
        assert_eq!(r.status, 404);
        assert!(r.body.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn respond_api_path_is_404_until_relays_exist() {
        let dir = bundle_with_404("api");
        let r = respond(&dir, Some("localhost"), "/api/pdf", None);
        assert_eq!(r.status, 404);
        assert!(r.body.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn respond_other_host_is_404() {
        let dir = bundle_with_404("other-host");
        let r = respond(&dir, Some("models"), "/", None);
        assert_eq!(r.status, 404);
        assert!(r.body.is_empty());
        let r = respond(&dir, None, "/", None);
        assert_eq!(r.status, 404);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn respond_windows_app_host_serves_index() {
        let dir = bundle_with_404("windows-host");
        let r = respond(&dir, Some("app.localhost"), "/", None);
        assert_eq!(r.status, 200);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn respond_page_miss_without_404_page_is_bare_404() {
        let dir = temp_root("no-404-page");
        let r = respond(&dir, Some("localhost"), "/org/", None);
        assert_eq!(r.status, 404);
        assert!(r.body.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
