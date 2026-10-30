//! Update check against GitHub releases. Ported from apps/desktop/src/update-check.ts.

use std::time::Duration;

use crate::fetch::is_js_space;
use crate::relay::shared::read_capped;

/// The releases list, one page of 30 (the newest desktop release is among them).
pub const RELEASES_URL: &str =
    "https://api.github.com/repos/Satwik-Miyyapuram/weaveforge/releases?per_page=30";
/// How long the releases request may take before the check gives up.
pub const UPDATE_TIMEOUT: Duration = Duration::from_secs(8);
/// Largest releases body read (new; TS had none). 4 MiB.
pub const MAX_RELEASES_BYTES: usize = 4 * 1024 * 1024;
/// The message the Tauri wiring uses when the check itself breaks. `check_update_reply` never returns it: a failed fetch is `None`, as in TS.
pub const UPDATE_CHECK_FAILED: &str = "Could not check for an update.";

/// One GitHub release (only the fields read). Unknown fields ignored.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct Release {
    /// The git tag, e.g. `v0.5.2`.
    pub tag_name: String,
    /// The release page.
    pub html_url: String,
    /// Draft releases are never offered.
    #[serde(default)]
    pub draft: bool,
    /// Pre-releases are never offered.
    #[serde(default)]
    pub prerelease: bool,
}

/// A newer release (TS `Update`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct Update {
    /// `major.minor.patch`.
    pub version: String,
    /// The release page to open.
    pub url: String,
}

/// major.minor.patch
pub type Version = (u64, u64, u64);

/// `v0.5.2` → `(0, 5, 2)`. Strict on purpose: the Android and Python tags in the same repository must not match.
#[must_use]
pub fn parse_tag(tag: &str) -> Option<Version> {
    let body = tag.trim_matches(is_js_space).strip_prefix('v')?;
    let mut parts = body.splitn(3, '.');
    let major = digits(parts.next()?)?;
    let minor = digits(parts.next()?)?;
    let patch = digits(parts.next()?)?;
    Some((major, minor, patch))
}

/// One non-empty run of ASCII digits, as a number. JS `\d` is ASCII only.
fn digits(part: &str) -> Option<u64> {
    if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    part.parse::<u64>().ok()
}

/// `0.5.2` → `(0, 5, 2)`, for the version this build was stamped with.
#[must_use]
pub fn parse_version(version: &str) -> Option<Version> {
    parse_tag(&format!("v{}", version.trim_matches(is_js_space)))
}

/// Whether `candidate` is a later version than `current`.
#[must_use]
pub fn is_newer(candidate: Version, current: Version) -> bool {
    candidate > current
}

/// The newest desktop release in the list, or nothing. A later equal version does not replace the first.
#[must_use]
pub fn newest_release(releases: &[Release]) -> Option<(Version, &Release)> {
    let mut best: Option<(Version, &Release)> = None;
    for release in releases {
        if release.draft || release.prerelease {
            continue;
        }
        let Some(version) = parse_tag(&release.tag_name) else {
            continue;
        };
        if best.is_none_or(|(known, _)| is_newer(version, known)) {
            best = Some((version, release));
        }
    }
    best
}

/// The releases from GitHub's public API. Unauthenticated, so no token ships in the binary.
/// # Errors
/// `releases: failed` when the request, the body or the JSON breaks; `releases: <status>` on a non-2xx answer.
pub async fn fetch_releases(url: &str) -> Result<Vec<Release>, String> {
    let client = reqwest::Client::builder()
        .timeout(UPDATE_TIMEOUT)
        .build()
        .map_err(|_| "releases: failed".to_string())?;
    let response = client
        .get(url)
        .header("accept", "application/vnd.github+json")
        .header("user-agent", "WeaveForge-Desktop")
        .send()
        .await
        .map_err(|_| "releases: failed".to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("releases: {}", status.as_u16()));
    }
    let body = read_capped(response, MAX_RELEASES_BYTES)
        .await
        .ok()
        .flatten()
        .ok_or_else(|| "releases: failed".to_string())?;
    releases_from_body(&body)
}

/// The releases in a body. Not an array is no releases; an item that does not parse is skipped.
fn releases_from_body(body: &[u8]) -> Result<Vec<Release>, String> {
    let value: serde_json::Value =
        serde_json::from_slice(body).map_err(|_| "releases: failed".to_string())?;
    let serde_json::Value::Array(items) = value else {
        return Ok(Vec::new());
    };
    Ok(items
        .into_iter()
        .filter_map(|item| serde_json::from_value::<Release>(item).ok())
        .collect())
}

/// The update to announce from `url`'s releases, or `None`: up to date, unreadable current version, or a failed fetch.
pub async fn find_update_at(current: &str, url: &str) -> Option<Update> {
    let current = parse_version(current)?;
    let releases = fetch_releases(url).await.ok()?;
    let (version, release) = newest_release(&releases)?;
    if !is_newer(version, current) {
        return None;
    }
    Some(Update {
        version: format!("{}.{}.{}", version.0, version.1, version.2),
        url: release.html_url.clone(),
    })
}

/// The update to announce from the real releases list.
pub async fn find_update(current: &str) -> Option<Update> {
    find_update_at(current, RELEASES_URL).await
}

/// What the check channel answers. A dev build asks nothing and gets `None`. The check itself never fails: a failed fetch is `None`.
/// # Errors
/// Never in practice; the `Err` arm is kept for the Tauri wiring.
pub async fn check_update_reply(packaged: bool, current: &str) -> Result<Option<Update>, String> {
    if !packaged {
        return Ok(None);
    }
    Ok(find_update(current).await)
}
