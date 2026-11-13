//! Path naming for the desktop shell's files (TS `apps/shell/sidecar/src/home-config.ts`, `mcp-rewrite.ts`).
//!
//! The separator and platform are inputs: the TS caller passes `path.sep` and `process.platform`, so the
//! same rule gives Windows or POSIX paths in tests without touching the host. Only the file naming lives
//! here; reading and writing the files stays in TypeScript.

/// Directory under the home folder that holds the home pointer (TS `HOME_CONFIG_DIR`).
pub const HOME_CONFIG_DIR: &str = ".weaveforge";
/// The home pointer's file name (TS `HOME_CONFIG_FILE`).
pub const HOME_CONFIG_FILE: &str = "desktop.json";

/// Joins path segments with `sep`, as Node's `path.join` does. Empty segments are skipped, runs of
/// separators collapse to one, `.` segments are dropped and `..` pops the segment before it. A `..`
/// that would climb above a root is dropped; a relative `..` that has nothing to pop is kept. A
/// trailing separator on the last part is kept. On `\` separators forward slashes become backslashes,
/// and a leading drive letter (`C:`) is kept as the root. No parts gives `""`; a path that resolves
/// to nothing gives `"."`, as Node does.
#[must_use]
pub fn join_path(sep: &str, parts: &[&str]) -> String {
    let win32 = sep == "\\";
    let joined = parts
        .iter()
        .filter(|part| !part.is_empty())
        .map(|part| {
            if win32 {
                part.replace('/', "\\")
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<String>>()
        .join(sep);
    if joined.is_empty() {
        return String::new();
    }
    let trailing = joined.ends_with(sep);
    let (root, rest) = split_root(sep, &joined);
    let absolute = !root.is_empty();

    let mut stack: Vec<&str> = Vec::new();
    for segment in rest.split(sep) {
        match segment {
            "" | "." => {}
            ".." => match stack.last() {
                Some(top) if *top != ".." => {
                    let _ = stack.pop();
                }
                _ if !absolute => stack.push(".."),
                _ => {}
            },
            name => stack.push(name),
        }
    }

    let mut out = root;
    out.push_str(&stack.join(sep));
    if out.is_empty() {
        out.push('.');
    }
    if trailing && !out.ends_with(sep) {
        out.push_str(sep);
    }
    out
}

/// Splits a leading root off `path`: an optional `X:` drive (win32 only), then an optional separator.
/// Returns the root as written and the rest with its leading separators removed.
fn split_root<'a>(sep: &str, path: &'a str) -> (String, &'a str) {
    let mut root = String::new();
    let mut rest = path;
    let bytes = path.as_bytes();
    if sep == "\\" && bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        root.push_str(&path[..2]);
        rest = &path[2..];
    }
    if rest.starts_with(sep) {
        root.push_str(sep);
        rest = rest.trim_start_matches(sep);
    }
    (root, rest)
}

/// The home pointer's file: `<home>/.weaveforge/desktop.json`, or `desktop-<variant>.json` for a
/// side-by-side build, so a dev build never reads the main app's folder.
#[must_use]
pub fn home_config_path(home: &str, variant: Option<&str>, sep: &str) -> String {
    let file = match variant.filter(|v| !v.is_empty()) {
        Some(variant) => format!("desktop-{variant}.json"),
        None => HOME_CONFIG_FILE.to_string(),
    };
    join_path(sep, &[home, HOME_CONFIG_DIR, &file])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_with_posix_separator() {
        assert_eq!(
            join_path("/", &["/home/u", ".cursor", "mcp.json"]),
            "/home/u/.cursor/mcp.json"
        );
        assert_eq!(join_path("/", &["/home/u/", "/.config"]), "/home/u/.config");
    }

    #[test]
    fn joins_with_win32_separator_and_converts_slashes() {
        assert_eq!(
            join_path("\\", &["C:\\Users\\u", ".cursor", "mcp.json"]),
            "C:\\Users\\u\\.cursor\\mcp.json"
        );
        assert_eq!(join_path("\\", &["C:/Users/u/", "x"]), "C:\\Users\\u\\x");
    }

    #[test]
    fn skips_empty_segments() {
        assert_eq!(join_path("/", &["", "a", "", "b"]), "a/b");
        assert_eq!(join_path("\\", &[]), "");
    }

    #[test]
    fn collapses_repeated_separators_posix() {
        assert_eq!(join_path("/", &["a//b"]), "a/b");
        assert_eq!(join_path("/", &["a", "/", "b"]), "a/b");
        assert_eq!(join_path("/", &["/", "/x"]), "/x");
    }

    #[test]
    fn collapses_repeated_separators_win32() {
        assert_eq!(join_path("\\", &["a\\\\b", "c//d"]), "a\\b\\c\\d");
        assert_eq!(join_path("\\", &["C:\\\\Users", "u"]), "C:\\Users\\u");
    }

    #[test]
    fn resolves_dot_and_dotdot_posix() {
        assert_eq!(join_path("/", &["/a/./b"]), "/a/b");
        assert_eq!(join_path("/", &["/a/b/../c"]), "/a/c");
        assert_eq!(join_path("/", &["/a", "../../.."]), "/");
        assert_eq!(join_path("/", &["a", "../b"]), "b");
        assert_eq!(join_path("/", &["..", "a"]), "../a");
        assert_eq!(join_path("/", &["a/.."]), ".");
        assert_eq!(join_path("/", &["./"]), "./");
    }

    #[test]
    fn resolves_dot_and_dotdot_win32() {
        assert_eq!(join_path("\\", &["C:\\a\\.\\b"]), "C:\\a\\b");
        assert_eq!(join_path("\\", &["C:/a/b/../c"]), "C:\\a\\c");
        assert_eq!(join_path("\\", &["C:\\", "..", "x"]), "C:\\x");
        assert_eq!(join_path("\\", &["a", "..\\..", "b"]), "..\\b");
    }

    #[test]
    fn keeps_trailing_separator() {
        assert_eq!(join_path("/", &["/a", "b/"]), "/a/b/");
        assert_eq!(join_path("\\", &["C:\\a", "b\\"]), "C:\\a\\b\\");
        assert_eq!(join_path("/", &["/"]), "/");
    }

    #[test]
    fn home_config_path_posix_and_win32() {
        assert_eq!(
            home_config_path("/home/u", None, "/"),
            "/home/u/.weaveforge/desktop.json"
        );
        assert_eq!(
            home_config_path("C:\\Users\\u", None, "\\"),
            "C:\\Users\\u\\.weaveforge\\desktop.json"
        );
    }

    #[test]
    fn mcp_client_configs_win32_uses_app_data() {
        let configs = crate::mcp_config_rewrite::mcp_client_configs(
            "C:\\Users\\u",
            "win32",
            Some("C:\\Users\\u\\AppData\\Roaming"),
            "\\",
        );
        assert_eq!(configs[0].file, "C:\\Users\\u\\.cursor\\mcp.json");
        assert_eq!(configs[0].key, "mcpServers");
        assert_eq!(
            configs[1].file,
            "C:\\Users\\u\\AppData\\Roaming\\Code\\User\\mcp.json"
        );
        assert_eq!(configs[1].key, "servers");
    }

    #[test]
    fn mcp_client_configs_win32_falls_back_to_home_roaming() {
        let configs =
            crate::mcp_config_rewrite::mcp_client_configs("C:\\Users\\u", "win32", None, "\\");
        assert_eq!(
            configs[1].file,
            "C:\\Users\\u\\AppData\\Roaming\\Code\\User\\mcp.json"
        );
    }

    #[test]
    fn mcp_client_configs_posix_per_platform() {
        let darwin = crate::mcp_config_rewrite::mcp_client_configs("/Users/u", "darwin", None, "/");
        assert_eq!(darwin[0].file, "/Users/u/.cursor/mcp.json");
        assert_eq!(
            darwin[1].file,
            "/Users/u/Library/Application Support/Code/User/mcp.json"
        );
        let linux =
            crate::mcp_config_rewrite::mcp_client_configs("/home/u", "linux", Some("ignored"), "/");
        assert_eq!(linux[1].file, "/home/u/.config/Code/User/mcp.json");
    }

    #[test]
    fn home_config_path_variant_gets_its_own_file() {
        assert_eq!(
            home_config_path("/home/u", Some("dev"), "/"),
            "/home/u/.weaveforge/desktop-dev.json"
        );
        assert_eq!(
            home_config_path("/home/u", Some(""), "/"),
            "/home/u/.weaveforge/desktop.json"
        );
    }
}
