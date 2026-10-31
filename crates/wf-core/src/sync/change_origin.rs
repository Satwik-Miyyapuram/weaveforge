//! Ports `packages/core/src/workspace/change-origin.ts`: which side changed a
//! mirrored file since the two last agreed. Digests are FNV-style and only
//! compared against values this app wrote, so they are not cryptographic.

/// The three digests a change check compares. Missing ones are `None`.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ChangeOrigin<'a> {
    /// Digest of the file the last mirror run left in the folder, if known.
    pub base: Option<&'a str>,
    /// Digest of the folder's copy as it reads now.
    pub folder: Option<&'a str>,
    /// Digest of the file the mirror would write from the workspace now.
    pub workspace: Option<&'a str>,
}

/// Who changed the file since the two sides last agreed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeSide {
    /// Nothing moved, or both sides arrived at the same text.
    Neither,
    /// Only the folder's copy moved.
    Folder,
    /// Only the workspace's copy moved.
    Workspace,
    /// Both moved to different text: a conflict to ask about.
    Both,
    /// Some digest is missing, so no guess is made.
    Unknown,
}

/// A short, stable digest of a file's text. Change detection only.
#[must_use]
pub fn digest_text(text: &str) -> String {
    // Two independent 32-bit walks over UTF-16 units, as the TypeScript does.
    let mut low: u32 = 0x811c_9dc5;
    let mut high: u32 = 0x0100_0193;
    for (index, unit) in text.encode_utf16().enumerate() {
        let index = u32::try_from(index).unwrap_or(u32::MAX);
        let code = u32::from(unit);
        low = (low ^ code).wrapping_mul(0x0100_0193);
        high = (high ^ code.wrapping_add(index)).wrapping_mul(0x85eb_ca6b);
    }
    format!("{low:08x}{high:08x}")
}

/// Who changed the file since the two sides last agreed.
///
/// `Unknown` where there is no base, so the caller shows the difference and
/// lets the user decide, as it did before this check existed.
#[must_use]
pub fn changed_side(origin: ChangeOrigin<'_>) -> ChangeSide {
    let ChangeOrigin {
        base,
        folder,
        workspace,
    } = origin;
    // The folder already holds what the mirror would write: nothing to import.
    if folder.is_some() && folder == workspace {
        return ChangeSide::Neither;
    }
    let (Some(base), Some(folder), Some(workspace)) = (base, folder, workspace) else {
        return ChangeSide::Unknown;
    };
    match (folder != base, workspace != base) {
        (true, true) => ChangeSide::Both,
        (true, false) => ChangeSide::Folder,
        (false, true) => ChangeSide::Workspace,
        (false, false) => ChangeSide::Neither,
    }
}
