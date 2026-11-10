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

/// Whether a stored entry is an absolute link: a desktop-local `app://artifacts/` entry, or a
/// URL that parses with an `http` or `https` scheme. Anything else (storage paths, junk) is not.
#[must_use]
pub fn is_absolute_url(value: &str) -> bool {
    if value.starts_with(LOCAL_ARTIFACT_PREFIX) {
        return true;
    }
    url::Url::parse(value).is_ok_and(|u| matches!(u.scheme(), "http" | "https"))
}

/// Whether text begins with `http://` or `https://`, ignoring ASCII case. Nothing is parsed.
fn has_http_scheme(entry: &str) -> bool {
    entry
        .get(..8)
        .is_some_and(|p| p.eq_ignore_ascii_case("https://"))
        || entry
            .get(..7)
            .is_some_and(|p| p.eq_ignore_ascii_case("http://"))
}

/// Whether an entry counts as absolute when listing artifacts: a desktop-local `app://artifacts/`
/// entry, a `data:` URI, or text starting with `http://` or `https://` in any case. Unlike
/// [`is_absolute_url`], nothing is parsed, so a bare `https://` prefix also counts.
#[must_use]
pub fn is_absolute_entry(entry: &str) -> bool {
    entry.starts_with(LOCAL_ARTIFACT_PREFIX) || entry.starts_with("data:") || has_http_scheme(entry)
}

/// How a stored artifact entry is shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArtifactKind {
    /// An image, shown inline.
    Image,
    /// A PDF, shown as a document.
    Pdf,
    /// Anything else, listed as a link.
    Link,
}

impl ArtifactKind {
    /// The lowercase name JavaScript receives: `image`, `pdf` or `link`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Pdf => "pdf",
            Self::Link => "link",
        }
    }
}

/// Image extensions, matched against the lowercased path.
const IMAGE_SUFFIXES: [&str; 7] = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"];

/// The lowercased path of an entry: a URL's path without query or fragment or, when the entry
/// does not parse as a URL, everything before the first `?`.
fn entry_path(entry: &str) -> String {
    match url::Url::parse(entry) {
        Ok(u) => u.path().to_lowercase(),
        Err(_) => entry.split('?').next().unwrap_or_default().to_lowercase(),
    }
}

/// How a stored entry is shown. A `data:` URI is classified by its MIME type alone; any other
/// entry by the extension of its path, ignoring case and query.
#[must_use]
pub fn artifact_kind(entry: &str) -> ArtifactKind {
    if entry.starts_with("data:") {
        return if entry.starts_with("data:image/") {
            ArtifactKind::Image
        } else if entry.starts_with("data:application/pdf") {
            ArtifactKind::Pdf
        } else {
            ArtifactKind::Link
        };
    }
    let path = entry_path(entry);
    if IMAGE_SUFFIXES.iter().any(|suffix| path.ends_with(*suffix)) {
        ArtifactKind::Image
    } else if path.ends_with(".pdf") {
        ArtifactKind::Pdf
    } else {
        ArtifactKind::Link
    }
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
    fn absolute_links_are_local_artifacts_or_web_urls() {
        assert!(is_absolute_url("app://artifacts/exp1/0a1b-uuid/loss.png"));
        assert!(is_absolute_url("https://wandb.ai/run/1"));
        assert!(is_absolute_url("http://localhost:6006/"));
        assert!(!is_absolute_url("user/exp/uuid/name.png"));
        assert!(!is_absolute_url("ftp://example.org/x"));
        assert!(!is_absolute_url("not a url"));
        assert!(!is_absolute_url(""));
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

    #[test]
    fn artifact_list_absolute_entries_match_the_web_rule() {
        for entry in [
            "app://artifacts/exp1/0a1b-uuid/loss.png",
            "data:image/png;base64,AAAA",
            "https://wandb.ai/run/1",
            "HTTPS://Example.org/x",
            "http://",
            "https://",
        ] {
            assert!(is_absolute_entry(entry), "{entry}");
        }
        for entry in [
            "user/exp/uuid/name.png",
            "ftp://example.org/x",
            "https:/x",
            "https:x",
            "xhttps://a",
            "app://artifactsX/a",
            "",
        ] {
            assert!(!is_absolute_entry(entry), "{entry}");
        }
    }

    #[test]
    fn an_entry_is_shown_as_an_image_a_pdf_or_a_link() {
        assert_eq!(
            artifact_kind("app://artifacts/exp1/0a1b-uuid/loss.PNG"),
            ArtifactKind::Image
        );
        assert_eq!(
            artifact_kind("https://cdn.example.org/fig.jpeg?v=2"),
            ArtifactKind::Image
        );
        assert_eq!(artifact_kind("user/exp/uuid/fig.webp"), ArtifactKind::Image);
        assert_eq!(
            artifact_kind("https://example.org/paper.pdf#page=2"),
            ArtifactKind::Pdf
        );
        assert_eq!(artifact_kind("user/exp/uuid/notes.pdf"), ArtifactKind::Pdf);
        assert_eq!(artifact_kind("https://wandb.ai/run/1"), ArtifactKind::Link);
        assert_eq!(
            artifact_kind("https://example.org/img.png/view"),
            ArtifactKind::Link
        );
    }

    #[test]
    fn a_data_uri_is_classified_by_its_mime_type_only() {
        assert_eq!(
            artifact_kind("data:image/png;base64,AAAA"),
            ArtifactKind::Image
        );
        assert_eq!(
            artifact_kind("data:application/pdf;base64,AAAA"),
            ArtifactKind::Pdf
        );
        assert_eq!(artifact_kind("data:text/plain,x.png"), ArtifactKind::Link);
    }
}
