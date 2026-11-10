//! Port of the pure parts of apps/desktop/src/model-cache.ts: which request is a weights request,
//! and which cache path a URL names. Pure. The download, the file writes and the response
//! building stay in the desktop shell.

use url::Url;

/// The cache's own hostname; the file a URL names is its path under this host.
pub const MODEL_HOST: &str = "models";

/// The folder of the app's own origin the renderer asks for weights under.
const MODEL_PATH: &str = "/models/";

/// The input is not a URL the parser accepts, or holds an escape `decodeURIComponent` rejects:
/// the cases where the TS threw rather than returned `null`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Malformed;

/// The cache URL a request names: `Ok(None)` when it is not a weights request, `Err` where the
/// TS threw on an unparseable URL.
///
/// The renderer asks under its own origin, `app://<app_host>/models/<repo>/...`: `app:` is not a
/// CORS-enabled scheme, so the same request to `app://models` would be blocked before it arrived.
///
/// # Errors
///
/// [`Malformed`] when `url` does not parse.
pub fn try_model_cache_url(url: &str, app_host: &str) -> Result<Option<String>, Malformed> {
    let parsed = Url::parse(url).map_err(|_| Malformed)?;
    let host = parsed.host_str().unwrap_or("");
    if host == MODEL_HOST {
        return Ok(Some(url.to_owned()));
    }
    if host != app_host {
        return Ok(None);
    }
    let Some(rest) = parsed.path().strip_prefix(MODEL_PATH) else {
        return Ok(None);
    };
    let search = parsed
        .query()
        .filter(|query| !query.is_empty())
        .map_or_else(String::new, |query| format!("?{query}"));
    Ok(Some(format!("app://{MODEL_HOST}/{rest}{search}")))
}

/// [`try_model_cache_url`] with the malformed case folded into `None`.
#[must_use]
pub fn model_cache_url(url: &str, app_host: &str) -> Option<String> {
    try_model_cache_url(url, app_host).ok().flatten()
}

/// The path segments a cache URL names under the cache root, or `None` when the URL is not a
/// cache file, or any segment would leave the root (malformed input is `None` here too).
///
/// Returns segments rather than a joined path so the desktop shell joins them with `path.join`,
/// as the TS does: a segment such as `C:` would replace the root in Rust's `PathBuf::join`.
///
/// # Errors
///
/// [`Malformed`] when `url` does not parse or its path holds an escape `decodeURIComponent` rejects.
pub fn try_cache_path_segments(url: &str) -> Result<Option<Vec<String>>, Malformed> {
    let parsed = Url::parse(url).map_err(|_| Malformed)?;
    let decoded = decode_uri_component(parsed.path()).ok_or(Malformed)?;
    let parts: Vec<String> = decoded
        .split('/')
        .filter(|part| !part.is_empty())
        .map(str::to_owned)
        .collect();
    let escapes = parts
        .iter()
        .any(|part| part == "." || part == ".." || part.contains('\\'));
    Ok((!parts.is_empty() && !escapes).then_some(parts))
}

/// [`try_cache_path_segments`] with the malformed case folded into `None`.
#[must_use]
pub fn cache_path_segments(url: &str) -> Option<Vec<String>> {
    try_cache_path_segments(url).ok().flatten()
}

/// `decodeURIComponent`: percent-escapes read as UTF-8. `None` where JavaScript would throw.
fn decode_uri_component(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while let Some(&byte) = bytes.get(index) {
        if byte != b'%' {
            out.push(byte);
            index += 1;
            continue;
        }
        let high = char::from(*bytes.get(index + 1)?).to_digit(16)?;
        let low = char::from(*bytes.get(index + 2)?).to_digit(16)?;
        out.push(u8::try_from(high * 16 + low).ok()?);
        index += 3;
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segments(parts: &[&str]) -> Option<Vec<String>> {
        Some(parts.iter().map(|part| (*part).to_owned()).collect())
    }

    #[test]
    fn a_repository_path_becomes_the_segments_of_a_file_under_the_cache_root() {
        assert_eq!(
            cache_path_segments("app://models/Xenova/all-MiniLM-L6-v2/resolve/main/config.json"),
            segments(&[
                "Xenova",
                "all-MiniLM-L6-v2",
                "resolve",
                "main",
                "config.json"
            ]),
        );
    }

    #[test]
    fn traversal_cannot_reach_outside_the_cache_directory() {
        // A plain `..` is resolved away by the URL itself before it is ever seen.
        assert_eq!(
            cache_path_segments("app://models/../../secrets.txt"),
            segments(&["secrets.txt"])
        );
        // An encoded one survives that, and is what the check is for.
        assert_eq!(cache_path_segments("app://models/a%2F..%2F..%2Fb"), None);
        assert_eq!(cache_path_segments("app://models/a%5C..%5Cb"), None);
    }

    #[test]
    fn a_request_for_nothing_in_particular_is_refused() {
        assert_eq!(cache_path_segments("app://models/"), None);
        assert_eq!(cache_path_segments("app://models"), None);
    }

    #[test]
    fn a_malformed_escape_is_refused_where_the_js_decode_would_throw() {
        assert_eq!(cache_path_segments("app://models/%zz/config.json"), None);
        assert_eq!(cache_path_segments("app://models/%2"), None);
        // A sign is not a hex digit, although Rust's integer parser would take it.
        assert_eq!(cache_path_segments("app://models/%+1"), None);
        // Escapes that are not valid UTF-8 throw in JS.
        assert_eq!(cache_path_segments("app://models/%FF"), None);
    }

    #[test]
    fn a_utf8_escape_decodes_to_its_character() {
        assert_eq!(
            cache_path_segments("app://models/%E2%82%AC.bin"),
            segments(&["€.bin"])
        );
    }

    #[test]
    fn the_same_origin_path_names_the_same_cached_file_as_the_model_host() {
        // The renderer at `app://weaveforge` cannot fetch `app://models`, so it asks under its own
        // origin and the weights come back as the model host's file.
        let same_origin = model_cache_url(
            "app://weaveforge/models/Xenova/m/resolve/main/config.json?x=1",
            "weaveforge",
        );
        assert_eq!(
            same_origin.as_deref(),
            Some("app://models/Xenova/m/resolve/main/config.json?x=1")
        );
        assert_eq!(
            cache_path_segments(same_origin.as_deref().unwrap_or("")),
            segments(&["Xenova", "m", "resolve", "main", "config.json"]),
        );
        let direct = "app://models/Xenova/m/resolve/main/config.json";
        assert_eq!(
            model_cache_url(direct, "weaveforge").as_deref(),
            Some(direct)
        );
    }

    #[test]
    fn only_the_models_folder_of_the_apps_own_host_is_a_weights_request() {
        assert_eq!(
            model_cache_url("app://weaveforge/settings/index.html", "weaveforge"),
            None
        );
        assert_eq!(
            model_cache_url("app://weaveforge/modelsx/a/config.json", "weaveforge"),
            None
        );
        assert_eq!(
            model_cache_url("app://weaveforge/models", "weaveforge"),
            None
        );
        assert_eq!(
            model_cache_url("app://elsewhere/models/a/config.json", "weaveforge"),
            None
        );
    }

    #[test]
    fn an_encoded_traversal_under_the_same_origin_path_is_still_refused() {
        let url = model_cache_url("app://weaveforge/models/a%2F..%2F..%2Fb", "weaveforge");
        assert_eq!(cache_path_segments(url.as_deref().unwrap_or("")), None);
    }

    #[test]
    fn malformed_input_is_an_error_and_a_refusal_is_not() {
        // Where the TS threw: an unparseable URL, or an escape decodeURIComponent rejects.
        assert_eq!(
            try_model_cache_url("not a url", "weaveforge"),
            Err(Malformed)
        );
        assert_eq!(try_cache_path_segments("not a url"), Err(Malformed));
        assert_eq!(
            try_cache_path_segments("app://models/%zz/config.json"),
            Err(Malformed)
        );
        // Where the TS returned null: not a weights request, or a traversal.
        assert_eq!(
            try_model_cache_url("app://elsewhere/a", "weaveforge"),
            Ok(None)
        );
        assert_eq!(try_cache_path_segments("app://models/a%2F..%2Fb"), Ok(None));
    }

    #[test]
    fn an_empty_query_is_dropped_as_the_search_is() {
        assert_eq!(
            model_cache_url("app://weaveforge/models/a/config.json?", "weaveforge").as_deref(),
            Some("app://models/a/config.json"),
        );
    }
}
