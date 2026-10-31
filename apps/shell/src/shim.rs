//! The script the shell injects into its main window, so the page finds `window.weaveforge`.

/// The bridge bundle, built from `bridge/inject.ts` by `bridge/build-shim.mjs`.
pub const BRIDGE_BUNDLE: &str = include_str!("../bridge/shim.gen.js");

/// The origins the app's own pages load from: `https://app.localhost` on Windows (`useHttpsScheme`),
/// `app://localhost` elsewhere. No plain-http entry: `http://app.localhost` resolves to loopback.
pub const APP_ORIGINS: [&str; 2] = ["https://app.localhost", "app://localhost"];

/// Whether a URL is one of the app's own pages: an `APP_ORIGINS` scheme and host with no explicit port.
#[must_use]
pub fn is_app_url(url: &tauri::Url) -> bool {
    url.port().is_none()
        && url.host_str().is_some_and(|host| {
            APP_ORIGINS.contains(&format!("{}://{host}", url.scheme()).as_str())
        })
}

/// Whether the main window may load a URL: an app page, or a scheme a frame uses
/// (`about:`, `blob:`, `data:`). Everything else is refused, as Electron's `will-navigate` did.
#[must_use]
pub fn main_window_keeps(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "about" | "blob" | "data") || is_app_url(url)
}

/// Whether a popup may open as its own app window: a `blob:` URL an app page made, such as a compiled PDF.
#[must_use]
pub fn is_app_blob(url: &tauri::Url) -> bool {
    url.scheme() == "blob" && tauri::Url::parse(url.path()).is_ok_and(|inner| is_app_url(&inner))
}

/// Node's name for an OS (`process.platform`), as `DesktopBridge.platform` expects it.
#[must_use]
pub fn platform_name(os: &str) -> &'static str {
    match os {
        "windows" => "win32",
        "macos" => "darwin",
        _ => "linux",
    }
}

/// The init script: the shell info, then the bundle, run only on the app's own origins.
/// An outside page that somehow loads in the window gets no bridge.
#[must_use]
pub fn init_script(version: &str, os: &str) -> String {
    let info = serde_json::json!({ "version": version, "platform": platform_name(os) });
    let origins = serde_json::json!(APP_ORIGINS);
    format!(
        "if ({origins}.includes(globalThis.location.origin)) {{\n\
         globalThis.__WEAVEFORGE_SHELL__ = {info};\n\
         {BRIDGE_BUNDLE}\n\
         }}\n"
    )
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]
    use super::*;

    #[test]
    fn platform_names_match_node() {
        assert_eq!(platform_name("windows"), "win32");
        assert_eq!(platform_name("macos"), "darwin");
        assert_eq!(platform_name("linux"), "linux");
        assert_eq!(platform_name("freebsd"), "linux");
    }

    #[test]
    fn script_sets_info_before_the_bundle_and_guards_the_origin() {
        let script = init_script("1.2.3", "windows");
        let guard = script
            .find(r#"["https://app.localhost","app://localhost"].includes(globalThis.location.origin)"#)
            .expect("origin guard");
        // Key order depends on serde_json's preserve_order feature, so compare the parsed value.
        let marker = "globalThis.__WEAVEFORGE_SHELL__ = ";
        let info = script.find(marker).expect("shell info");
        let rest = &script[info + marker.len()..];
        let json = &rest[..rest.find(";\n").expect("info ends")];
        let parsed: serde_json::Value = serde_json::from_str(json).expect("info is JSON");
        assert_eq!(parsed, serde_json::json!({ "platform": "win32", "version": "1.2.3" }));
        let bundle = script.find(BRIDGE_BUNDLE).expect("bundle");
        assert!(guard < info && info < bundle);
        assert!(script.trim_end().ends_with('}'));
    }

    #[test]
    fn version_is_json_escaped() {
        let script = init_script("1\"; alert(1); \"", "linux");
        assert!(script.contains(r#""version":"1\"; alert(1); \"""#));
    }

    #[test]
    fn bundle_reads_the_shell_info_and_installs_the_bridge() {
        assert!(BRIDGE_BUNDLE.contains("__WEAVEFORGE_SHELL__"));
        assert!(BRIDGE_BUNDLE.contains(".weaveforge = desktopBridge("));
    }

    fn url(text: &str) -> tauri::Url {
        tauri::Url::parse(text).expect("url")
    }

    #[test]
    fn app_urls_are_the_app_scheme_origins_only() {
        assert!(is_app_url(&url("https://app.localhost/")));
        assert!(is_app_url(&url("https://app.localhost/papers?id=1#x")));
        assert!(is_app_url(&url("app://localhost/index.html")));
    }

    #[test]
    fn other_urls_are_not_app_urls() {
        for text in [
            "http://app.localhost/",
            "https://app.localhost:8443/",
            "https://evil.app.localhost/",
            "https://app.localhost.evil.com/",
            "app://evil/",
            "https://weaveforge.org/",
            "http://127.0.0.1:53682/auth/callback?code=x",
            "about:blank",
            "data:text/html,hi",
        ] {
            assert!(!is_app_url(&url(text)), "{text}");
        }
    }

    #[test]
    fn main_window_keeps_app_pages_and_frame_schemes_only() {
        for text in [
            "https://app.localhost/papers",
            "app://localhost/",
            "about:blank",
            "about:srcdoc",
            "blob:https://app.localhost/5f0c",
            "data:text/html,hi",
        ] {
            assert!(main_window_keeps(&url(text)), "{text}");
        }
        for text in [
            "https://weaveforge.org/",
            "http://app.localhost/",
            "https://app.localhost:8443/",
            "http://127.0.0.1:53682/",
            "mailto:x@example.com",
            "file:///c:/x",
            "javascript:alert(1)",
            "ms-settings:privacy",
            "zoommtg://zoom.us/join",
        ] {
            assert!(!main_window_keeps(&url(text)), "{text}");
        }
    }

    #[test]
    fn only_app_made_blobs_open_as_windows() {
        assert!(is_app_blob(&url("blob:https://app.localhost/5f0c-11")));
        assert!(is_app_blob(&url("blob:app://localhost/5f0c-11")));
        for text in [
            "blob:https://evil.com/5f0c",
            "blob:http://app.localhost/5f0c",
            "blob:null/5f0c",
            "https://app.localhost/x.pdf",
            "data:application/pdf,x",
        ] {
            assert!(!is_app_blob(&url(text)), "{text}");
        }
    }

    #[test]
    fn guard_lists_no_plain_http_origin() {
        assert!(init_script("1", "windows").starts_with(
            r#"if (["https://app.localhost","app://localhost"].includes(globalThis.location.origin))"#
        ));
        assert!(!APP_ORIGINS.iter().any(|origin| origin.starts_with("http:")));
    }
}
