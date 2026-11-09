//! Experiment artifact names and view URLs. Port of `safeName` and `viewableArtifactUrl` in
//! apps/web/src/features/experiments/infrastructure/experiment-artifact-store.ts. Pure.

/// The desktop-local artifact scheme recorded by the Electron shell.
const LOCAL_ARTIFACT_PREFIX: &str = "app://artifacts/";
/// The longest segment a storage key or artifact name may have.
const MAX_SEGMENT: usize = 128;
/// The name used when nothing printable survives cleaning.
const FALLBACK_NAME: &str = "artifact";

/// Whether a character may appear in a storage key segment.
fn is_safe_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')
}

/// A filename that is safe as one storage key segment.
///
/// Each run of characters outside `[A-Za-z0-9._-]` becomes one dash, leading dots and dashes
/// are dropped, and the result is cut to 128 characters. A name that reduces to nothing becomes
/// `artifact`.
#[must_use]
pub fn safe_name(name: &str) -> String {
    let mut cleaned = String::with_capacity(name.len());
    let mut in_gap = false;
    for c in name.chars() {
        if is_safe_char(c) {
            cleaned.push(c);
            in_gap = false;
        } else if !in_gap {
            cleaned.push('-');
            in_gap = true;
        }
    }
    let trimmed = cleaned.trim_start_matches(['.', '-']);
    let cut: String = trimmed.chars().take(MAX_SEGMENT).collect();
    if cut.is_empty() {
        FALLBACK_NAME.to_owned()
    } else {
        cut
    }
}

/// Whether one path segment of a desktop-local entry is a safe storage segment.
fn is_safe_segment(segment: &str) -> bool {
    (1..=MAX_SEGMENT).contains(&segment.len())
        && segment.chars().all(is_safe_char)
        && segment != "."
        && segment != ".."
}

/// The URL to render for a stored entry.
///
/// Outside the Tauri shell, or for any entry that is not a desktop-local `app://artifacts/` one,
/// the entry is returned unchanged. Inside the shell a local entry is served on the page origin
/// under `/artifacts/`, but only when its path is exactly `{experiment}/{folder}/{name}` of safe
/// segments; otherwise `None`, so `..` or `%2e%2e` can never reach another route.
#[must_use]
pub fn viewable_artifact_url(entry: &str, in_shell: bool) -> Option<String> {
    if !in_shell {
        return Some(entry.to_owned());
    }
    let Some(rest) = entry.strip_prefix(LOCAL_ARTIFACT_PREFIX) else {
        return Some(entry.to_owned());
    };
    let segments: Vec<&str> = rest.split('/').collect();
    let safe = segments.len() == 3 && segments.iter().all(|s| is_safe_segment(s));
    safe.then(|| format!("/artifacts/{}", segments.join("/")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picked_filename_becomes_one_storage_segment() {
        assert_eq!(safe_name("loss curve.png"), "loss-curve.png");
        assert_eq!(safe_name("../../etc/passwd"), "etc-passwd");
        assert_eq!(safe_name("..."), "artifact");
        assert_eq!(safe_name(""), "artifact");
    }

    #[test]
    fn a_very_long_name_is_cut_rather_than_refused() {
        let long = format!("{}.png", "a".repeat(300));
        assert_eq!(safe_name(&long).chars().count(), 128);
    }

    #[test]
    fn inside_the_shell_a_desktop_local_upload_renders_on_the_page_origin() {
        assert_eq!(
            viewable_artifact_url("app://artifacts/exp1/0a1b-uuid/loss.png", true).as_deref(),
            Some("/artifacts/exp1/0a1b-uuid/loss.png"),
        );
    }

    #[test]
    fn outside_the_shell_the_recorded_url_is_unchanged() {
        assert_eq!(
            viewable_artifact_url("app://artifacts/exp1/0a1b-uuid/loss.png", false).as_deref(),
            Some("app://artifacts/exp1/0a1b-uuid/loss.png"),
        );
        assert_eq!(
            viewable_artifact_url("app://artifacts/../x", false).as_deref(),
            Some("app://artifacts/../x"),
        );
    }

    #[test]
    fn absolute_web_links_and_storage_paths_are_unchanged_inside_the_shell() {
        assert_eq!(
            viewable_artifact_url("https://wandb.ai/run/1", true).as_deref(),
            Some("https://wandb.ai/run/1"),
        );
        assert_eq!(
            viewable_artifact_url("user/exp/uuid/name.png", true).as_deref(),
            Some("user/exp/uuid/name.png"),
        );
    }

    #[test]
    fn only_the_exact_prefix_is_rewritten() {
        assert_eq!(
            viewable_artifact_url("app://artifactsX/a", true).as_deref(),
            Some("app://artifactsX/a"),
        );
    }

    #[test]
    fn inside_the_shell_crafted_entries_render_nothing() {
        for crafted in [
            "app://artifacts/../api/x",
            "app://artifacts/%2e%2e/api/x",
            "app://artifacts/a/b/../../x",
            "app://artifacts/a/./b",
            "app://artifacts/a/b",
            "app://artifacts/a/b/c/d",
            "app://artifacts/a//b",
            "app://artifacts/a/b/c%2Fd",
            "app://artifacts/a\\b/c/d",
        ] {
            assert_eq!(viewable_artifact_url(crafted, true), None, "{crafted}");
        }
    }
}
