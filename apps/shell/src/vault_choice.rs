//! Moving the workspace to a folder the reader picked: the session, the remembered folder and the folder watch move together.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::prefs::{PrefValue, Prefs};
use crate::vault::{VaultRoot, VaultState};
use crate::vault_watcher::{ChangeSink, VaultWatcher, WatchSlot};

/// The preference that remembers the workspace folder between runs.
pub const ROOT_PREF: &str = "vault-root";

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
        match start(Path::new(&picked.path), sink) {
            Ok(watcher) => slot.set(Some(watcher)),
            Err(reason) => warnings.push(reason),
        }
    }
    drop(session);
    drop(old);
    Ok(Choice { root, warnings })
}
