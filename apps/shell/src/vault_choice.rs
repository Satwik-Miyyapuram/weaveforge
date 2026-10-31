//! Moving the workspace to a folder the reader picked: the session, the remembered folder and the folder watch move together.

use std::path::Path;
use std::time::Duration;

use crate::prefs::{PrefValue, Prefs};
use crate::vault::{VaultRoot, VaultState};
use crate::vault_watcher::{ChangeSink, VaultWatcher, WatchSlot};

/// The preference that remembers the workspace folder between runs.
pub const ROOT_PREF: &str = "vault-root";

/// Said (logged) when the folder works but could not be remembered for the next start.
pub const NOT_REMEMBERED: &str =
    "The workspace folder could not be remembered; it will be asked for again next time.";

/// What a pick did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Choice {
    /// The folder now in use; `None` when none is chosen.
    pub root: Option<VaultRoot>,
    /// Problems that do not undo the pick (watch or remembering failed), for the app log.
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
    adopt_inner(vault, prefs, slot, chosen, sink, |slot, root, sink| {
        watch_root(slot, root, sink)
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
    adopt_inner(vault, prefs, slot, chosen, sink, |slot, root, sink| {
        watch_root_with(slot, root, sink, quiet, window)
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

/// Shared pick flow; `watch` is the only part that differs between default and given timings.
///
/// The session stays locked for the whole pick, so two picks run one after the other and the
/// session, remembered folder and watch always end on the same folder.
fn adopt_inner(
    vault: &VaultState,
    prefs: &Prefs,
    slot: &WatchSlot,
    chosen: Option<&Path>,
    sink: ChangeSink,
    watch: impl FnOnce(&WatchSlot, &Path, ChangeSink) -> Result<(), String>,
) -> Result<Choice, String> {
    let Some(chosen) = chosen else {
        return Ok(Choice {
            root: vault.lock().root(),
            warnings: Vec::new(),
        });
    };
    let mut session = vault.lock();
    let old = session.root();
    // Stop the old folder first: its reports must never be read against the new folder.
    slot.set(None);
    let root = match session.choose(Some(chosen)) {
        Ok(root) => root,
        Err(reason) => {
            if let Some(old) = old {
                let _ = watch(slot, Path::new(&old.path), sink);
            }
            return Err(reason);
        }
    };
    let mut warnings = Vec::new();
    if let Some(picked) = &root {
        if prefs
            .write(ROOT_PREF, Some(PrefValue::Text(picked.path.clone())))
            .is_err()
        {
            warnings.push(NOT_REMEMBERED.to_owned());
        }
        if let Err(reason) = watch(slot, Path::new(&picked.path), sink) {
            warnings.push(reason);
        }
    }
    Ok(Choice { root, warnings })
}
