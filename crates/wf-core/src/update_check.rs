//! Desktop update check: strict release-tag parsing, version comparison and the newest
//! stable release. Pure. The fetch and the dialog stay in the desktop shell.

use serde::{Deserialize, Serialize};

/// A `major.minor.patch` version as three numbers.
pub type Version = [u64; 3];

/// One release as the update check reads it. GitHub sends more fields; they are ignored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "ReleaseRow"))]
pub struct Release {
    /// The git tag, for example `v0.5.2`.
    pub tag_name: String,
    /// The release page the reader is sent to.
    pub html_url: String,
    /// Whether the release is a draft. Absent means not a draft.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub draft: Option<bool>,
    /// Whether the release is a pre-release. Absent means not one.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub prerelease: Option<bool>,
}

/// The newest stable desktop release: its version and page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct NewestRelease {
    /// The version, as three numbers.
    #[cfg_attr(feature = "specta", specta(type = (u32, u32, u32)))]
    pub version: Version,
    /// The release page.
    pub url: String,
}

/// Parse `v<major>.<minor>.<patch>` after trimming whitespace.
///
/// Deliberately strict. The repository's releases are not all this app's: Android builds are
/// tagged `android-vN` and the Python SDK `py-v0.6.0`, and either would otherwise sort as the
/// newest thing on offer.
#[must_use]
pub fn parse_tag(tag: &str) -> Option<Version> {
    let rest = tag.trim().strip_prefix('v')?;
    let mut parts = rest.split('.');
    let major = digits(parts.next()?)?;
    let minor = digits(parts.next()?)?;
    let patch = digits(parts.next()?)?;
    if parts.next().is_some() {
        return None;
    }
    Some([major, minor, patch])
}

/// Parse a bare `major.minor.patch` version, as stamped into the build.
#[must_use]
pub fn parse_version(version: &str) -> Option<Version> {
    parse_tag(&format!("v{}", version.trim()))
}

/// Whether `candidate` is a later version than `current`.
#[must_use]
pub fn is_newer(candidate: Version, current: Version) -> bool {
    candidate > current
}

/// The newest non-draft, non-pre-release desktop tag in `releases`, or `None`.
///
/// Releases are read rather than trusted in order: a patch published after a later minor would
/// otherwise win. On a tie the first release listed is kept.
#[must_use]
pub fn newest_release(releases: &[Release]) -> Option<NewestRelease> {
    let mut best: Option<NewestRelease> = None;
    for release in releases {
        if release.draft == Some(true) || release.prerelease == Some(true) {
            continue;
        }
        let Some(version) = parse_tag(&release.tag_name) else {
            continue;
        };
        if best
            .as_ref()
            .is_none_or(|current| is_newer(version, current.version))
        {
            best = Some(NewestRelease {
                version,
                url: release.html_url.clone(),
            });
        }
    }
    best
}

/// A non-empty run of ASCII digits, as a number, or `None`.
fn digits(part: &str) -> Option<u64> {
    if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    part.parse().ok()
}
