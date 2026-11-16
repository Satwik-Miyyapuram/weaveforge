//! Moving the workspace to a folder the reader picked: the session, the remembered folder and the folder watch move together.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use wf_store::root::WORKSPACE_SUBDIR;

use crate::prefs::{PrefValue, Prefs};
use crate::vault::{VaultRoot, VaultState};
use crate::vault_watcher::{ChangeSink, VaultWatcher, WatchSlot};

/// The preference that remembers the workspace folder between runs.
pub const ROOT_PREF: &str = "vault-root";

/// Set once the reader has answered the first-open question (picked a folder or skipped).
pub const ASKED_PREF: &str = "workspace-asked";

/// Said when a pick lands inside the app's own install folder, which is never a workspace.
pub const INSIDE_INSTALL: &str =
    "That folder is inside the WeaveForge app folder. Pick a folder outside the app.";

/// Said (logged) when the folder works but could not be remembered for the next start.
pub const NOT_REMEMBERED: &str =
    "The workspace folder could not be remembered; it will be asked for again next time.";

/// Said when the folder was let go for this run but is still remembered for the next start.
pub const NOT_FORGOTTEN: &str = "The folder was disconnected, but could not be forgotten; it will be taken up again next start.";

/// What a pick did.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct Choice {
    /// The folder now in use; `None` when none is chosen.
    pub root: Option<VaultRoot>,
    /// Problems that do not undo the pick (watch or remembering failed), for the page and the app log.
    pub warnings: Vec<String>,
}

/// Stops the running watch, then watches `root`.
/// # Errors
/// The reader-facing reason `root` cannot be watched; no watch is left running.
pub fn watch_root(slot: &WatchSlot, root: &Path, sink: ChangeSink) -> Result<(), String> {
    replace_watch(slot, || VaultWatcher::start(root, sink))
}

/// Same as `watch_root`, with the quiet period and self-write window given (tests use short ones).
/// # Errors
/// The reader-facing reason `root` cannot be watched; no watch is left running.
pub fn watch_root_with(
    slot: &WatchSlot,
    root: &Path,
    sink: ChangeSink,
    quiet: Duration,
    window: Duration,
) -> Result<(), String> {
    replace_watch(slot, || VaultWatcher::start_with(root, sink, quiet, window))
}

/// Adopts the folder the reader picked; `None` is a cancelled dialog.
/// # Errors
/// The reader-facing reason the folder cannot hold a workspace; nothing changes.
pub fn adopt_choice(
    vault: &VaultState,
    prefs: &Prefs,
    slot: &WatchSlot,
    chosen: Option<&Path>,
    sink: ChangeSink,
) -> Result<Choice, String> {
    adopt_inner(vault, prefs, slot, chosen, sink, |root, sink| {
        VaultWatcher::start(root, sink)
    })
}

/// Same as `adopt_choice`, with the watch quiet period and self-write window given (tests use short ones).
/// # Errors
/// The reader-facing reason the folder cannot hold a workspace; nothing changes.
pub fn adopt_choice_with(
    vault: &VaultState,
    prefs: &Prefs,
    slot: &WatchSlot,
    chosen: Option<&Path>,
    sink: ChangeSink,
    quiet: Duration,
    window: Duration,
) -> Result<Choice, String> {
    adopt_inner(vault, prefs, slot, chosen, sink, |root, sink| {
        VaultWatcher::start_with(root, sink, quiet, window)
    })
}

/// Drops the old watch before starting the new one, so the old folder never keeps reporting.
fn replace_watch(
    slot: &WatchSlot,
    start: impl FnOnce() -> Result<VaultWatcher, String>,
) -> Result<(), String> {
    slot.set(None);
    let watcher = start()?;
    slot.set(Some(watcher));
    Ok(())
}

/// Adopts the folder remembered from the last run. A folder that is missing (an unplugged drive,
/// a network share not mounted yet) keeps the preference for next time; one that exists but can
/// no longer hold the workspace is forgotten so the reader is asked again.
#[must_use]
pub fn restore_remembered(vault: &VaultState, prefs: &Prefs) -> Option<VaultRoot> {
    let Ok(Some(PrefValue::Text(path))) = prefs.read(ROOT_PREF) else {
        return None;
    };
    let restored = vault.lock().restore(Some(&path));
    if restored.is_none() && Path::new(&path).exists() {
        let _ = prefs.write(ROOT_PREF, None);
    }
    restored
}

/// Whether the first-open question should be asked: no folder is remembered and the reader has
/// not answered it before. A folder remembered from an older version counts as an answer.
#[must_use]
pub fn setup_needed(prefs: &Prefs) -> bool {
    remembered(prefs).is_none()
        && !matches!(prefs.read(ASKED_PREF), Ok(Some(PrefValue::Flag(true))))
}

/// Marks the first-open question as answered when the reader already has data from an earlier
/// run: the app's data folder has content, or the Electron-era data folder does. Call it before
/// the database opens, since opening it creates the folder. Existing users are never asked.
pub fn note_earlier_data(prefs: &Prefs, data_dir: &Path, electron_dir: Option<&Path>) {
    let earlier = has_content(data_dir) || electron_dir.is_some_and(has_content);
    if earlier {
        let _ = prefs.write(ASKED_PREF, Some(PrefValue::Flag(true)));
    }
}

/// Whether `dir` exists and holds at least one entry.
fn has_content(dir: &Path) -> bool {
    fs::read_dir(dir).is_ok_and(|mut entries| entries.next().is_some())
}

/// The folder Skip uses: `WeaveForge` inside the reader's Documents folder.
#[must_use]
pub fn default_workspace_folder(documents: &Path) -> PathBuf {
    documents.join(WORKSPACE_SUBDIR)
}

/// Refuses a folder that is the app's install folder or inside it. Whole path components only,
/// so a sibling that shares the text prefix is allowed. `None` (install folder unknown) refuses nothing.
///
/// # Errors
/// The reader-facing reason; the pick changes nothing.
pub fn refuse_install_dir(chosen: &Path, install: Option<&Path>) -> Result<(), String> {
    match install {
        Some(install) if chosen.starts_with(install) => Err(INSIDE_INSTALL.to_owned()),
        _ => Ok(()),
    }
}

/// The folder the running app was installed into (its executable's folder).
#[must_use]
pub fn current_install_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
}

/// The remembered folder, as text; `None` when none is remembered.
fn remembered(prefs: &Prefs) -> Option<String> {
    match prefs.read(ROOT_PREF) {
        Ok(Some(PrefValue::Text(path))) if !path.is_empty() => Some(path),
        _ => None,
    }
}

/// The remembered folder while none is in use: it was missing at start (an unplugged drive,
/// a share not mounted yet). `None` when a folder is in use or none is remembered.
#[must_use]
pub fn missing_remembered(vault: &VaultState, prefs: &Prefs) -> Option<String> {
    if vault.lock().root().is_some() {
        return None;
    }
    remembered(prefs)
}

/// Tries the remembered folder again, as a pick of that folder; nothing remembered answers the
/// current folder unchanged.
/// # Errors
/// The reader-facing reason the folder still cannot hold a workspace; nothing changes.
pub fn retry_remembered(
    vault: &VaultState,
    prefs: &Prefs,
    slot: &WatchSlot,
    sink: ChangeSink,
) -> Result<Choice, String> {
    let path = remembered(prefs).map(PathBuf::from);
    adopt_choice(vault, prefs, slot, path.as_deref(), sink)
}

/// Stops using the folder: the session lets it go, its watch stops and it is no longer
/// remembered. The watch is joined after the lock is let go, as in a pick.
#[must_use]
pub fn forget_choice(vault: &VaultState, prefs: &Prefs, slot: &WatchSlot) -> Choice {
    let mut session = vault.lock();
    session.forget();
    let old = slot.take();
    if let Some(old) = &old {
        old.halt();
    }
    let mut warnings = Vec::new();
    if prefs.write(ROOT_PREF, None).is_err() {
        warnings.push(NOT_FORGOTTEN.to_owned());
    }
    drop(session);
    drop(old);
    Choice {
        root: None,
        warnings,
    }
}

/// Shared pick flow; `start` is the only part that differs between default and given timings.
///
/// The session stays locked for the whole pick, so two picks run one after the other and the
/// session, remembered folder and watch always end on the same folder. A refused pick never
/// touches the old watch, so the old folder is watched without a gap. On a good pick the old
/// watch is halted under the lock (its news must not be read against the new folder) and
/// joined only after the lock is let go, so a slow stop never stalls the vault commands.
fn adopt_inner(
    vault: &VaultState,
    prefs: &Prefs,
    slot: &WatchSlot,
    chosen: Option<&Path>,
    sink: ChangeSink,
    start: impl FnOnce(&Path, ChangeSink) -> Result<VaultWatcher, String>,
) -> Result<Choice, String> {
    let Some(chosen) = chosen else {
        return Ok(Choice {
            root: vault.lock().root(),
            warnings: Vec::new(),
        });
    };
    refuse_install_dir(chosen, current_install_dir().as_deref())?;
    let mut session = vault.lock();
    let root = session.choose(Some(chosen))?;
    let old = slot.take();
    if let Some(old) = &old {
        old.halt();
    }
    let mut warnings = Vec::new();
    if let Some(picked) = &root {
        if prefs
            .write(ROOT_PREF, Some(PrefValue::Text(picked.path.clone())))
            .is_err()
        {
            warnings.push(NOT_REMEMBERED.to_owned());
        }
        // Answered now, so the first-open question is not asked again.
        let _ = prefs.write(ASKED_PREF, Some(PrefValue::Flag(true)));
        match start(Path::new(&picked.path), sink) {
            Ok(watcher) => slot.set(Some(watcher)),
            Err(reason) => warnings.push(reason),
        }
    }
    drop(session);
    drop(old);
    Ok(Choice { root, warnings })
}
