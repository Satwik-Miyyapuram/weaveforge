//! The pre-migration dump for the 0.9.7 export (`migrate097Backup`): `pre-migration-<stamp>.dump`
//! in the migration folder. A name is never replaced. The dump step is passed in, so the file
//! rules test without Postgres.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use serde::Serialize;

const DIR_REL: &str = ".weaveforge/migration-0.9.7";

/// What the TS exporter reads back: this device's id, and the dump's file name inside the
/// migration folder (the name `report.json` records as `backup`).
#[derive(Debug, Serialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupOut {
    /// This device's id (`device-id` in app data).
    pub device_id: String,
    /// File name of the dump, `pre-migration-<stamp>.dump`.
    pub dump: String,
}

/// Writes `pre-migration-<stamp>.dump` into the migration folder through `dump`. The name is
/// reserved before `dump` runs, so an existing dump is never replaced. A failed dump removes its
/// partial file.
pub fn write_backup(
    folder: &Path,
    device_id: &str,
    stamp: &str,
    dump: &mut dyn FnMut(&Path) -> Result<(), String>,
) -> Result<BackupOut, String> {
    if stamp.is_empty() || !stamp.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err("refused: backup stamp must be letters, digits or '-'".to_owned());
    }
    let dir = folder.join(DIR_REL);
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let name = format!("pre-migration-{stamp}.dump");
    let path = dir.join(&name);
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
    {
        Ok(_) => {}
        Err(e) if e.kind() == ErrorKind::AlreadyExists => {
            return Err(format!("refused: {name} already exists"));
        }
        Err(e) => return Err(format!("cannot create {}: {e}", path.display())),
    }
    if let Err(err) = dump(&path) {
        let _ = fs::remove_file(&path);
        return Err(err);
    }
    Ok(BackupOut {
        device_id: device_id.to_owned(),
        dump: name,
    })
}
