//! The KEYS marker `<folder>/.weaveforge/migration-0.9.7/secrets-moved-<deviceId>.json`, written once
//! the one-time move of old `local_secrets` rows into the OS keychain has succeeded. The body is
//! `{count, deviceId}`, never a secret value. Remove-old reads it. The marker is per device, so a
//! marker written on another device does not count as "moved" here.
//!
//! The move stores one keychain entry per field (`device-secrets/<key>`), because Windows caps a
//! single credential blob at 2560 bytes. An index entry (`device-secrets/_index`) lists the keys and
//! who wrote them: `move` for this migration, `save` for the page. The index is written before the
//! marker, so a failed marker can be retried. A `save` index is never overwritten; the old rows stay
//! where they are and the marker is written. An index that cannot be read is `CorruptIndex`, and
//! `reset_corrupt_index` clears it so the move can run again.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::Value;
use tauri::Manager;

use crate::cmd_vault;
use crate::commands::{LocalDb, ShellError};
use crate::secrets::{DEVICE_SECRETS, SecretError, Secrets, WRITE_ONLY, is_device_field};
use crate::vault::VaultState;

/// The index entry: the keys the device's fields are stored under, and who wrote them.
const INDEX: &str = "device-secrets/_index";
/// The top-level name the index entry uses; never a credential field.
const RESERVED_INDEX_KEY: &str = "_index";

/// Windows' cap on one credential blob, in bytes. Checked in UTF-16 units times two, as the web does.
pub const FIELD_LIMIT: usize = 2560;

/// Reads the device's old secrets rows. Read only: the rows are never changed or removed.
pub const READ_LOCAL_SECRETS_SQL: &str = "select secrets from local_secrets";

/// Whether the old database folder exists. Read only, metadata only: the database is never opened.
/// The page asks this when a read of the old rows fails: a missing folder means no old secrets.
#[tauri::command]
#[specta::specta]
#[must_use]
#[allow(
    clippy::needless_pass_by_value,
    reason = "tauri commands take State by value"
)]
pub fn legacy_db_present(db: tauri::State<'_, LocalDb>) -> bool {
    db.legacy_db_present()
}

/// Moves the old rows into the keychain and records the move. The workspace folder is the vault
/// root on this side, never a value from the page. EXPORT calls it after the export is verified and
/// before remove-old.
///
/// Returns the names of write-only fields that were not moved, never their values. A rerun after a
/// marker exists moves nothing and returns none.
///
/// # Errors
/// The keychain's reason when a field is not stored (for example `NoKeychain` on a machine without
/// one), or the database's reason when the rows cannot be read. No marker is written on either.
#[tauri::command]
#[specta::specta]
pub async fn migrate_097_move_secrets(
    app: tauri::AppHandle,
    secrets: tauri::State<'_, Secrets>,
    db: tauri::State<'_, LocalDb>,
    vault: tauri::State<'_, VaultState>,
) -> Result<Vec<String>, ShellError> {
    let folder = cmd_vault::root(&vault)
        .await
        .map(|root| PathBuf::from(root.path))
        .ok_or_else(|| ShellError::from("No workspace folder is chosen.".to_owned()))?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|err| ShellError::from(err.to_string()))?;
    let device = crate::device_id::get_or_create(&app_data)
        .map_err(|err| ShellError::from(err.to_string()))?;
    if !crate::device_id::is_file_name_id(&device) {
        return Err(ShellError::from(format!(
            "the device id {device:?} is not usable in a file name"
        )));
    }
    // No legacy database folder means no old rows: a fresh install moves zero rows. A stopped or
    // unreadable database is an error, so the save that asked for the move is refused.
    let rows = if db.legacy_db_present() {
        db.query(READ_LOCAL_SECRETS_SQL.to_owned(), Vec::new())
            .await?
    } else {
        Vec::new()
    };
    secrets
        .queued(move |s| move_into_keychain(s, &folder, &device, &rows))
        .await
        .map_err(ShellError::from)
}

/// Stores the row's fields in the keychain, then writes the index and the marker. A marker for this
/// device makes this a no-op. A `save` index records the marker without moving anything.
///
/// # Errors
/// `CorruptIndex` when the index is unreadable, `SeveralRows` for more than one row, `BadRow` for a
/// row that is not the expected JSON, `TooLong` for a field over the cap (checked before any write),
/// the keychain's error for a field that could not be stored, `Locked` when the keychain cannot be
/// read, or `MarkerFailed` when every field moved but the marker could not be written.
///
/// Returns the names of the write-only fields that were not moved (their values are never
/// returned). A rerun for a device that already has a marker is a no-op and returns none.
pub fn move_into_keychain(
    secrets: &Secrets,
    folder: &Path,
    device: &str,
    rows: &[Value],
) -> Result<Vec<String>, SecretError> {
    strip_write_only_keys(secrets)?;
    if marker_matches(secrets, folder, device) {
        return Ok(Vec::new());
    }
    if rows.len() > 1 {
        return Err(SecretError::SeveralRows);
    }
    let marker = |unmoved: &[String]| {
        record_secrets_moved(folder, device, rows.len(), unmoved)
            .map_err(|_| SecretError::MarkerFailed)
    };
    let (fields, skipped) = row_fields(rows)?;
    match index_source(secrets)? {
        IndexSource::Save => {
            // The save index is the truth: a key it does not list was deleted by the user and stays
            // deleted. Only a listed key whose entry is missing gets its old value back. A routed
            // token lives under its own entry name: its old value comes back only when that entry is
            // gone. When the page already saved a newer one, the old value is left alone: that is
            // not loss, so it is not reported.
            let listed = listed_keys(secrets)?;
            let mut restore = Vec::new();
            for (key, text) in &fields {
                if routed_name(key).is_some() {
                    if secrets.read(&entry_name(key))?.is_none() {
                        restore.push((key.clone(), text.clone()));
                    }
                } else if listed.contains(key) && secrets.read(&field_name(key))?.is_none() {
                    restore.push((key.clone(), text.clone()));
                }
            }
            store_fields(secrets, &restore)?;
            marker(&skipped)?;
            return Ok(skipped);
        }
        IndexSource::Move | IndexSource::Absent => {}
    }
    // A routed token has its own entry, so it is left out of the index. An empty row (no rows at
    // all) still writes an empty move index, so the move is recorded.
    let keys: Vec<String> = fields
        .iter()
        .map(|(key, _)| key.clone())
        .filter(|key| routed_name(key).is_none())
        .collect();
    check_index_fits(&keys)?;
    store_move_fields(secrets, &fields)?;
    write_index(secrets, "move", &keys)?;
    marker(&skipped)?;
    clear_verified_copies(secrets);
    Ok(skipped)
}

/// Clears a `device-secrets/<token>` copy of a routed token, but only where the native routed entry
/// already holds the same value. Runs after the move is recorded, so a copy whose value differs from
/// the native entry (a newer or unique token) is kept. Errors are ignored: the move is already done,
/// and a leftover copy is harmless because the page never reads it.
fn clear_verified_copies(secrets: &Secrets) {
    for (old, _) in ROUTED {
        let field = field_name(old);
        let Ok(Some(copy)) = secrets.read(&field) else {
            continue;
        };
        let native = secrets.read(&entry_name(old)).ok().flatten();
        if native.as_deref() == Some(copy.as_str()) {
            let _ = secrets.clear(&field);
        }
    }
}

/// The `(key, text)` fields to store and the names of the skipped write-only fields.
type RowFields = (Vec<(String, String)>, Vec<String>);

/// The `(key, text)` fields of the one old row and the names of the write-only fields that were
/// skipped. Both are empty when there are no rows.
fn row_fields(rows: &[Value]) -> Result<RowFields, SecretError> {
    match rows.first() {
        None => Ok((Vec::new(), Vec::new())),
        Some(row) => device_fields(row),
    }
}

/// Legacy top-level keys that the native shell reads under their own entry name. They are stored
/// there, not under `device-secrets/`.
const ROUTED: [(&str, &str); 2] = [
    ("overleafToken", "overleaf-token"),
    ("gitSyncToken", "git-sync-token"),
];

/// The entry name a routed legacy key is stored under, or `None` for an ordinary device field.
fn routed_name(key: &str) -> Option<&'static str> {
    ROUTED
        .iter()
        .find(|(old, _)| *old == key)
        .map(|(_, new)| *new)
}

/// The keys the index lists. Call only after `index_source` has read the index as valid.
fn listed_keys(secrets: &Secrets) -> Result<Vec<String>, SecretError> {
    let text = secrets.read(INDEX)?.unwrap_or_default();
    let index: Value = serde_json::from_str(&text).map_err(|_| SecretError::CorruptIndex)?;
    Ok(index["keys"]
        .as_array()
        .map(|keys| {
            keys.iter()
                .filter_map(|key| key.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default())
}

/// Removes write-only names from an existing index, keeping its source. An index from before the
/// routing fix can list them, and the page reads every listed key, so it would fail on them. The
/// routed names are removed only because `WRITE_ONLY` lists them too (`is_write_only_key` checks
/// that list, not `ROUTED`). A missing or unreadable index is left for `index_source` to report.
fn strip_write_only_keys(secrets: &Secrets) -> Result<(), SecretError> {
    let source = match index_source(secrets) {
        Ok(IndexSource::Absent) | Err(SecretError::CorruptIndex) => return Ok(()),
        Ok(IndexSource::Move) => "move",
        Ok(IndexSource::Save) => "save",
        Err(other) => return Err(other),
    };
    let keys = listed_keys(secrets)?;
    let kept: Vec<String> = keys
        .iter()
        .filter(|key| !is_write_only_key(key))
        .cloned()
        .collect();
    if kept.len() == keys.len() {
        return Ok(());
    }
    write_index(secrets, source, &kept)
}

/// True for a key whose first dot segment is a write-only name. Such a key is never read back by
/// the page.
fn is_write_only_key(key: &str) -> bool {
    WRITE_ONLY.contains(&key.split('.').next().unwrap_or(key))
}

/// Clears the index when it is unreadable, so the move can run again. A readable index is left
/// alone. Clearing it does not touch the field entries.
///
/// # Errors
/// `Locked` or `Unreachable` when the index cannot be read or cleared.
pub fn reset_corrupt_index(secrets: &Secrets) -> Result<(), SecretError> {
    match index_source(secrets) {
        Err(SecretError::CorruptIndex) => secrets.clear(INDEX),
        Ok(_) => Ok(()),
        Err(other) => Err(other),
    }
}

/// Where the keychain's index came from.
enum IndexSource {
    /// No index: nothing saved here yet.
    Absent,
    /// An index this migration wrote on an earlier attempt: safe to overwrite.
    Move,
    /// The page saved credentials here: never overwritten.
    Save,
}

/// Reads the index. An index that is not JSON, or names no known source, is `CorruptIndex`: it is
/// refused rather than overwritten.
fn index_source(secrets: &Secrets) -> Result<IndexSource, SecretError> {
    match secrets.read(INDEX)? {
        None => Ok(IndexSource::Absent),
        Some(text) => match serde_json::from_str::<Value>(&text) {
            Ok(index) if index["source"] == "move" => Ok(IndexSource::Move),
            Ok(index) if index["source"] == "save" => Ok(IndexSource::Save),
            _ => Err(SecretError::CorruptIndex),
        },
    }
}

/// The `(key, text)` pairs of one row. A top-level string is one field; an object is one field per
/// sub-key, named `<name>.<sub>` with its JSON text. Empty strings are not stored. A write-only
/// name is moved only as a routed string (`overleafToken`, `gitSyncToken`); any other write-only
/// field is skipped and its name returned, never its value. Every field is checked here, before
/// the first keychain write.
fn device_fields(row: &Value) -> Result<RowFields, SecretError> {
    let parsed: Value;
    let value: &Value = match row.get("secrets") {
        Some(Value::String(text)) => {
            parsed = serde_json::from_str(text).map_err(|_| SecretError::BadRow)?;
            &parsed
        }
        Some(other) => other,
        None => return Err(SecretError::BadRow),
    };
    let Value::Object(map) = value else {
        return Err(SecretError::BadRow);
    };
    let mut fields = Vec::new();
    let mut skipped = Vec::new();
    for (name, field) in map {
        // A dot is the separator between a name and its sub-key, and a leading `_` is reserved (the
        // index entry is `_index`), so a top-level name may hold neither.
        if name.contains('.') || name.starts_with('_') {
            return Err(SecretError::BadRow);
        }
        let write_only = WRITE_ONLY.contains(&name.as_str());
        match field {
            Value::String(text) if text.is_empty() => {}
            Value::String(_) if write_only && routed_name(name).is_none() => {
                skipped.push(name.clone());
            }
            Value::String(text) => push_field(&mut fields, name.clone(), text.clone())?,
            Value::Object(nested) => {
                for (sub, nested_value) in nested {
                    if nested_value.is_null() {
                        continue;
                    }
                    let key = format!("{name}.{}", sub_key(sub));
                    if write_only {
                        skipped.push(key);
                    } else {
                        push_field(&mut fields, key, nested_value.to_string())?;
                    }
                }
            }
            _ => return Err(SecretError::BadRow),
        }
    }
    Ok((fields, skipped))
}

/// A sub-key as a keychain name part. Plain alphanumeric names pass through; any other name is
/// hex-encoded behind `_` (which plain names never start with), so it never holds a dot or a
/// character a keychain name cannot take. The web store decodes the same form.
#[must_use]
pub fn sub_key(sub: &str) -> String {
    if !sub.is_empty() && sub.bytes().all(|b| b.is_ascii_alphanumeric()) {
        sub.to_owned()
    } else {
        format!("_{}", hex(sub.as_bytes()))
    }
}

/// Adds a field after checking that its key can be a keychain entry name and that its text fits.
fn push_field(
    fields: &mut Vec<(String, String)>,
    key: String,
    text: String,
) -> Result<(), SecretError> {
    // `_index` is the index entry's own name; a credential under it would overwrite the index.
    if key == RESERVED_INDEX_KEY
        || (routed_name(&key).is_none() && !is_device_field(&field_name(&key)))
    {
        return Err(SecretError::BadRow);
    }
    if text.is_empty() {
        return Ok(());
    }
    if text.encode_utf16().count() * 2 > FIELD_LIMIT {
        return Err(SecretError::TooLong);
    }
    fields.push((key, text));
    Ok(())
}

/// The keychain entry name for one field key.
fn field_name(key: &str) -> String {
    format!("{DEVICE_SECRETS}/{key}")
}

/// The keychain entry name for one field key: its routed entry, or `device-secrets/<key>`.
fn entry_name(key: &str) -> String {
    routed_name(key).map_or_else(|| field_name(key), str::to_owned)
}

/// One keychain write per field. The first failure is returned. The index is written last, so a
/// partial failure leaves no readable index and a retry rewrites every field.
fn store_fields(secrets: &Secrets, fields: &[(String, String)]) -> Result<(), SecretError> {
    for (key, text) in fields {
        secrets.write(&entry_name(key), text)?;
    }
    Ok(())
}

/// The move's keychain writes. A routed token whose native entry already exists is newer than the
/// old row (the native shell wrote it since), so it is left as it is.
fn store_move_fields(secrets: &Secrets, fields: &[(String, String)]) -> Result<(), SecretError> {
    for (key, text) in fields {
        if routed_name(key).is_some() && secrets.read(&entry_name(key))?.is_some() {
            continue;
        }
        secrets.write(&entry_name(key), text)?;
    }
    Ok(())
}

/// The index body the move writes for `keys`. Checked against the cap before any field is stored.
fn check_index_fits(keys: &[String]) -> Result<(), SecretError> {
    let body = serde_json::json!({ "source": "move", "keys": keys }).to_string();
    if body.encode_utf16().count() * 2 > FIELD_LIMIT {
        return Err(SecretError::TooLong);
    }
    Ok(())
}

/// Writes the index: its `source` (`move` or `save`) and the keys it lists.
fn write_index(secrets: &Secrets, source: &str, keys: &[String]) -> Result<(), SecretError> {
    let body = serde_json::json!({ "source": source, "keys": keys }).to_string();
    secrets.write(INDEX, &body)
}

/// Where this device's marker lives inside the workspace folder.
#[must_use]
pub fn marker_path(folder: &Path, device: &str) -> PathBuf {
    folder
        .join(".weaveforge")
        .join("migration-0.9.7")
        .join(format!("secrets-moved-{device}.json"))
}

/// True when this device's marker exists, names this device, and the keychain still backs it. A
/// marker from another device is not a move on this one. A marker whose keychain entries are gone
/// (cleared, or the index unreadable) is not trusted, so the move runs again.
fn marker_matches(secrets: &Secrets, folder: &Path, device: &str) -> bool {
    let marked = fs::read_to_string(marker_path(folder, device))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .is_some_and(|marker| marker["deviceId"] == device);
    marked && keychain_backs_index(secrets)
}

/// True when the index is a `move` or `save` index and every key it lists has a keychain entry.
fn keychain_backs_index(secrets: &Secrets) -> bool {
    if !matches!(
        index_source(secrets),
        Ok(IndexSource::Move | IndexSource::Save)
    ) {
        return false;
    }
    listed_keys(secrets).is_ok_and(|keys| {
        keys.iter()
            .all(|key| matches!(secrets.read(&field_name(key)), Ok(Some(_))))
    })
}

/// Writes this device's marker, `{count, deviceId}` plus `unmoved` when any write-only field was
/// left behind, atomically. `count` is the number of rows the marker covers. `unmoved` lists field
/// NAMES only. The marker holds no secret value.
///
/// # Errors
/// Fails when the marker folder cannot be created or the marker cannot be written.
pub fn record_secrets_moved(
    folder: &Path,
    device: &str,
    count: usize,
    unmoved: &[String],
) -> io::Result<()> {
    let mut body = serde_json::json!({
        "count": count,
        "deviceId": device,
    });
    if !unmoved.is_empty() {
        body["unmoved"] = serde_json::json!(unmoved);
    }
    let body = serde_json::to_vec(&body).map_err(io::Error::other)?;
    let path = marker_path(folder, device);
    write_atomic(&path, &body)
}

/// Writes `body` to `path` through a temp file of its own, synced before the rename. Each write
/// has a unique temp name, so concurrent writers never share one. A fixed-name `.json.part` left by
/// an older build is removed first.
fn write_atomic(path: &Path, body: &[u8]) -> io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::other("the marker has no folder"))?;
    fs::create_dir_all(dir)?;
    match fs::remove_file(path.with_extension("json.part")) {
        Ok(()) => {}
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => return Err(err),
    }
    let part = unique_part(path);
    let written = (|| {
        let mut file = File::create_new(&part)?;
        file.write_all(body)?;
        file.sync_all()
    })();
    if let Err(err) = written {
        let _ = fs::remove_file(&part);
        return Err(err);
    }
    let mut renamed = fs::rename(&part, path);
    // Windows refuses a replace (access denied) while another writer has the marker open. The
    // synced temp file is intact, so a short bounded retry lands the write.
    for _ in 0..RENAME_RETRIES {
        if !matches!(&renamed, Err(err) if err.kind() == io::ErrorKind::PermissionDenied) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
        renamed = fs::rename(&part, path);
    }
    if renamed.is_err() {
        let _ = fs::remove_file(&part);
    }
    renamed
}

/// How many times a rename that Windows refuses with access denied is retried.
const RENAME_RETRIES: usize = 40;

/// A temp name unique to this write: pid, nanos and a process-wide counter.
fn unique_part(path: &Path) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let file = path.file_name().unwrap_or_default().to_string_lossy();
    path.with_file_name(format!("{file}.{}-{nanos}-{seq}.part", std::process::id()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use keyring_core::CredentialStore;
    use keyring_core::mock::Cred;

    use super::*;

    const DEVICE: &str = "device-a";

    /// A scratch workspace folder under the temp dir, removed on drop.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("wf-secrets-moved-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("scratch folder");
            Self(dir)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn read_marker(folder: &Path) -> Value {
        let text = fs::read_to_string(marker_path(folder, DEVICE)).expect("marker is written");
        serde_json::from_str(&text).expect("marker is JSON")
    }

    fn store() -> Arc<CredentialStore> {
        keyring_core::mock::Store::new().expect("mock store")
    }

    fn fake_keychain(store: &Arc<CredentialStore>) -> Secrets {
        Secrets::new(Some(Arc::clone(store)), "test")
    }

    /// Makes the next keychain call on (`test`, `name`) fail once with `err`.
    fn inject(store: &Arc<CredentialStore>, name: &str, err: keyring_core::Error) {
        let entry = store.build("test", name, None).expect("entry");
        entry
            .as_any()
            .downcast_ref::<Cred>()
            .expect("mock credential")
            .set_error(err);
    }

    fn old_row(text: &str) -> Value {
        serde_json::json!({ "secrets": text })
    }

    fn move_now(secrets: &Secrets, folder: &Path, rows: &[Value]) -> Result<(), SecretError> {
        move_into_keychain(secrets, folder, DEVICE, rows).map(|_| ())
    }

    #[test]
    fn all_rows_moved_writes_marker_with_count_one() {
        let dir = Scratch::new("all-moved");
        let secrets = fake_keychain(&store());
        move_now(&secrets, &dir.0, &[old_row(r#"{"plainToken":"tok"}"#)]).expect("moves");
        assert_eq!(
            read_marker(&dir.0),
            serde_json::json!({ "count": 1, "deviceId": DEVICE })
        );
        assert_eq!(
            secrets.read("device-secrets/plainToken").expect("read"),
            Some("tok".to_owned())
        );
    }

    #[test]
    fn one_keychain_failure_writes_no_marker() {
        let dir = Scratch::new("one-fail");
        let st = store();
        inject(
            &st,
            "device-secrets/plainToken",
            keyring_core::Error::NoStorageAccess("locked".into()),
        );
        let secrets = fake_keychain(&st);
        let rows = [old_row(r#"{"plainToken":"tok","otherToken":"g"}"#)];
        assert!(move_now(&secrets, &dir.0, &rows).is_err());
        assert!(!marker_path(&dir.0, DEVICE).exists());
    }

    #[test]
    fn no_rows_writes_empty_move_index_and_count_zero() {
        let dir = Scratch::new("no-rows");
        let secrets = fake_keychain(&store());
        move_now(&secrets, &dir.0, &[]).expect("moves nothing");
        assert_eq!(read_marker(&dir.0)["count"], 0);
        let index: Value =
            serde_json::from_str(&secrets.read(INDEX).expect("read").expect("index written"))
                .expect("index is JSON");
        assert_eq!(index["source"], "move");
        assert!(index["keys"].as_array().expect("keys").is_empty());
    }

    #[test]
    fn no_keychain_writes_no_marker() {
        let dir = Scratch::new("no-keychain");
        let secrets = Secrets::new(None, "test");
        let rows = [old_row(r#"{"plainToken":"tok"}"#)];
        assert!(move_now(&secrets, &dir.0, &rows).is_err());
        assert!(!marker_path(&dir.0, DEVICE).exists());
    }

    #[test]
    fn locked_keychain_moves_nothing_and_writes_no_marker() {
        let dir = Scratch::new("locked");
        let st = store();
        inject(
            &st,
            INDEX,
            keyring_core::Error::NoStorageAccess("locked".into()),
        );
        let secrets = fake_keychain(&st);
        let rows = [old_row(r#"{"plainToken":"tok"}"#)];
        assert!(matches!(
            move_now(&secrets, &dir.0, &rows),
            Err(SecretError::Locked)
        ));
        assert!(!marker_path(&dir.0, DEVICE).exists());
    }

    #[test]
    fn a_save_index_is_never_overwritten_and_recorded_as_save() {
        let dir = Scratch::new("save-index");
        let secrets = fake_keychain(&store());
        secrets
            .write(INDEX, r#"{"source":"save","keys":["plainToken"]}"#)
            .expect("save index");
        secrets
            .write("device-secrets/plainToken", "typed")
            .expect("typed value");
        move_now(&secrets, &dir.0, &[old_row(r#"{"plainToken":"old"}"#)])
            .expect("save on this device is a no-op move");
        assert_eq!(
            read_marker(&dir.0),
            serde_json::json!({ "count": 1, "deviceId": DEVICE })
        );
        assert_eq!(
            secrets.read("device-secrets/plainToken").expect("read"),
            Some("typed".to_owned())
        );
    }

    #[test]
    fn a_marker_for_this_device_is_a_no_op() {
        let dir = Scratch::new("same-device");
        let secrets = fake_keychain(&store());
        // A marker is trusted only while the index and its fields are still in the keychain.
        secrets
            .write(INDEX, r#"{"source":"move","keys":["plainToken"]}"#)
            .expect("index");
        secrets
            .write("device-secrets/plainToken", "kept")
            .expect("field");
        record_secrets_moved(&dir.0, DEVICE, 1, &[]).expect("marker");
        move_now(&secrets, &dir.0, &[old_row(r#"{"plainToken":"tok"}"#)]).expect("no-op");
        assert_eq!(
            secrets.read("device-secrets/plainToken").expect("read"),
            Some("kept".to_owned())
        );
    }

    #[test]
    fn a_marker_for_another_device_does_not_count_as_moved() {
        let dir = Scratch::new("other-device");
        let secrets = fake_keychain(&store());
        record_secrets_moved(&dir.0, "device-b", 1, &[]).expect("marker");
        move_now(&secrets, &dir.0, &[old_row(r#"{"plainToken":"tok"}"#)]).expect("moves here");
        assert_eq!(
            secrets.read("device-secrets/plainToken").expect("read"),
            Some("tok".to_owned())
        );
        assert_eq!(
            read_marker(&dir.0),
            serde_json::json!({ "count": 1, "deviceId": DEVICE })
        );
    }

    #[test]
    fn a_copied_marker_naming_another_device_does_not_count_as_moved() {
        let dir = Scratch::new("copied-marker");
        let secrets = fake_keychain(&store());
        write_atomic(
            &marker_path(&dir.0, DEVICE),
            br#"{"count":1,"deviceId":"device-b"}"#,
        )
        .expect("copied marker");
        move_now(&secrets, &dir.0, &[old_row(r#"{"plainToken":"tok"}"#)]).expect("moves here");
        assert_eq!(
            secrets.read("device-secrets/plainToken").expect("read"),
            Some("tok".to_owned())
        );
    }

    #[test]
    fn an_unreadable_index_is_corrupt_and_nothing_is_moved() {
        let dir = Scratch::new("corrupt-index");
        let secrets = fake_keychain(&store());
        secrets.write(INDEX, "not json").expect("damaged index");
        assert!(matches!(
            move_now(&secrets, &dir.0, &[old_row(r#"{"plainToken":"tok"}"#)]),
            Err(SecretError::CorruptIndex)
        ));
        assert_eq!(
            secrets.read("device-secrets/plainToken").expect("read"),
            None
        );
        assert!(!marker_path(&dir.0, DEVICE).exists());
    }

    #[test]
    fn an_index_with_an_unknown_source_is_corrupt() {
        let dir = Scratch::new("unknown-source");
        let secrets = fake_keychain(&store());
        secrets
            .write(INDEX, r#"{"source":"other","keys":[]}"#)
            .expect("index");
        assert!(matches!(
            move_now(&secrets, &dir.0, &[]),
            Err(SecretError::CorruptIndex)
        ));
    }

    #[test]
    fn reset_clears_a_corrupt_index_so_the_move_runs_again() {
        let dir = Scratch::new("reset-corrupt");
        let secrets = fake_keychain(&store());
        secrets.write(INDEX, "not json").expect("damaged index");
        reset_corrupt_index(&secrets).expect("reset");
        assert_eq!(secrets.read(INDEX).expect("read"), None);
        move_now(&secrets, &dir.0, &[old_row(r#"{"plainToken":"tok"}"#)]).expect("moves");
        assert_eq!(read_marker(&dir.0)["count"], 1);
    }

    #[test]
    fn reset_leaves_a_readable_index_alone() {
        let secrets = fake_keychain(&store());
        secrets
            .write(INDEX, r#"{"source":"save","keys":["plainToken"]}"#)
            .expect("save index");
        reset_corrupt_index(&secrets).expect("reset is a no-op");
        assert_eq!(
            secrets.read(INDEX).expect("read"),
            Some(r#"{"source":"save","keys":["plainToken"]}"#.to_owned())
        );
    }

    #[test]
    fn a_top_level_name_starting_with_underscore_is_refused() {
        let dir = Scratch::new("underscore-name");
        let secrets = fake_keychain(&store());
        assert!(matches!(
            move_now(&secrets, &dir.0, &[old_row(r#"{"_hidden":{"a":"x"}}"#)]),
            Err(SecretError::BadRow)
        ));
        assert!(!marker_path(&dir.0, DEVICE).exists());
    }

    #[test]
    fn several_rows_are_refused_with_no_marker() {
        let dir = Scratch::new("several");
        let secrets = fake_keychain(&store());
        let rows = [old_row("{}"), old_row("{}")];
        assert!(matches!(
            move_now(&secrets, &dir.0, &rows),
            Err(SecretError::SeveralRows)
        ));
        assert!(!marker_path(&dir.0, DEVICE).exists());
    }

    #[test]
    fn a_malformed_row_is_refused_with_bad_row_and_no_marker() {
        let dir = Scratch::new("malformed");
        let secrets = fake_keychain(&store());
        assert!(matches!(
            move_now(&secrets, &dir.0, &[old_row("not json")]),
            Err(SecretError::BadRow)
        ));
        assert!(!marker_path(&dir.0, DEVICE).exists());
    }

    #[test]
    fn a_top_level_name_with_a_dot_is_refused() {
        let dir = Scratch::new("dot-name");
        let secrets = fake_keychain(&store());
        assert!(matches!(
            move_now(&secrets, &dir.0, &[old_row(r#"{"a.b":"x"}"#)]),
            Err(SecretError::BadRow)
        ));
        assert!(!marker_path(&dir.0, DEVICE).exists());
    }

    #[test]
    fn a_top_level_name_of_index_is_refused_because_it_would_overwrite_the_index() {
        let dir = Scratch::new("reserved-index");
        let secrets = fake_keychain(&store());
        assert!(matches!(
            move_now(&secrets, &dir.0, &[old_row(r#"{"_index":"x"}"#)]),
            Err(SecretError::BadRow)
        ));
        assert_eq!(secrets.read(INDEX).expect("read"), None);
        assert!(!marker_path(&dir.0, DEVICE).exists());
    }

    #[test]
    fn the_marker_holds_names_and_counts_but_never_a_secret_value() {
        let dir = Scratch::new("marker-no-values");
        let secrets = fake_keychain(&store());
        let row = old_row(r#"{"plainToken":"SECRET-VALUE-XYZ"}"#);
        move_now(&secrets, &dir.0, &[row]).expect("moves");
        let text = std::fs::read_to_string(marker_path(&dir.0, DEVICE)).expect("marker");
        assert!(
            !text.contains("SECRET-VALUE-XYZ"),
            "marker leaked a value: {text}"
        );
    }

    #[test]
    fn a_row_whose_json_column_is_already_an_object_moves() {
        let dir = Scratch::new("object-row");
        let secrets = fake_keychain(&store());
        let row = serde_json::json!({ "secrets": { "plainToken": "tok" } });
        move_now(&secrets, &dir.0, &[row]).expect("moves");
        assert_eq!(
            secrets.read("device-secrets/plainToken").expect("read"),
            Some("tok".to_owned())
        );
    }

    #[test]
    fn an_odd_sub_key_is_hex_encoded_into_the_entry_name() {
        let dir = Scratch::new("odd-sub");
        let secrets = fake_keychain(&store());
        move_now(
            &secrets,
            &dir.0,
            &[old_row(r#"{"ai-provider":{"a b":"v"}}"#)],
        )
        .expect("moves");
        // "a b" is 61 20 62 in hex.
        assert_eq!(
            secrets
                .read("device-secrets/ai-provider._612062")
                .expect("read"),
            Some("\"v\"".to_owned())
        );
        assert_eq!(sub_key("abc"), "abc");
        assert_eq!(sub_key(""), "_");
        assert_eq!(sub_key("a.b"), "_612e62");
    }

    #[test]
    fn a_field_over_the_windows_cap_is_refused_before_any_write() {
        let dir = Scratch::new("too-long");
        let secrets = fake_keychain(&store());
        // 2048 UTF-16 units are 4096 bytes, over the 2560-byte cap.
        let big = "x".repeat(2048);
        let row = old_row(&format!(r#"{{"otherToken":"small","plainToken":"{big}"}}"#));
        assert!(matches!(
            move_now(&secrets, &dir.0, &[row]),
            Err(SecretError::TooLong)
        ));
        assert_eq!(
            secrets.read("device-secrets/otherToken").expect("read"),
            None
        );
        assert_eq!(secrets.read(INDEX).expect("read"), None);
        assert!(!marker_path(&dir.0, DEVICE).exists());
    }

    #[test]
    fn a_field_of_exactly_the_cap_is_accepted() {
        let dir = Scratch::new("at-cap");
        let secrets = fake_keychain(&store());
        // 1280 UTF-16 units are 2560 bytes: exactly the cap.
        let edge = "x".repeat(1280);
        let row = old_row(&format!(r#"{{"plainToken":"{edge}"}}"#));
        move_now(&secrets, &dir.0, &[row]).expect("moves");
    }

    #[test]
    fn move_reads_the_old_rows_with_a_select_only() {
        assert!(READ_LOCAL_SECRETS_SQL.starts_with("select "));
        assert!(!READ_LOCAL_SECRETS_SQL.contains("delete"));
        assert!(!READ_LOCAL_SECRETS_SQL.contains("update"));
    }

    #[test]
    fn device_id_is_created_once_then_reused_and_differs_per_app_data_folder() {
        let a = Scratch::new("device-a");
        let b = Scratch::new("device-b");
        let first = crate::device_id::get_or_create(&a.0).expect("created");
        assert_eq!(first.len(), 64);
        assert!(first.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(
            crate::device_id::get_or_create(&a.0).expect("reused"),
            first
        );
        assert_ne!(
            crate::device_id::get_or_create(&b.0).expect("created"),
            first
        );
    }

    #[test]
    fn a_key_the_user_deleted_from_a_save_stays_deleted_when_the_move_reruns() {
        let dir = Scratch::new("deleted-key");
        let secrets = fake_keychain(&store());
        // The save index lists only plainToken: otherToken was deleted by the user. The marker
        // was removed, so the move runs again with the old row that still holds otherToken.
        let save_index = r#"{"source":"save","keys":["plainToken"]}"#;
        secrets.write(INDEX, save_index).expect("save index");
        secrets
            .write("device-secrets/plainToken", "typed")
            .expect("typed value");
        let row = old_row(r#"{"plainToken":"old","otherToken":"g"}"#);
        move_now(&secrets, &dir.0, &[row]).expect("moves");
        assert_eq!(
            secrets.read("device-secrets/otherToken").expect("read"),
            None
        );
        assert_eq!(
            secrets.read("device-secrets/plainToken").expect("read"),
            Some("typed".to_owned())
        );
        assert_eq!(
            secrets.read(INDEX).expect("read"),
            Some(save_index.to_owned())
        );
        assert_eq!(
            read_marker(&dir.0),
            serde_json::json!({ "count": 1, "deviceId": DEVICE })
        );
    }

    #[test]
    fn a_save_restores_a_routed_token_whose_entry_is_gone_and_skips_one_still_present() {
        let dir = Scratch::new("save-routed");
        let secrets = fake_keychain(&store());
        secrets
            .write(INDEX, r#"{"source":"save","keys":["plainToken"]}"#)
            .expect("save index");
        secrets
            .write("overleaf-token", "newer")
            .expect("native overleaf");
        let row = old_row(r#"{"gitSyncToken":"old-git","overleafToken":"old-overleaf"}"#);
        let skipped = move_into_keychain(&secrets, &dir.0, DEVICE, &[row]).expect("moves");
        assert_eq!(
            secrets.read("git-sync-token").expect("read"),
            Some("old-git".to_owned())
        );
        assert_eq!(
            secrets.read("overleaf-token").expect("read"),
            Some("newer".to_owned())
        );
        // The page already saved a newer token: that is not loss, so nothing is reported.
        assert!(
            skipped.is_empty(),
            "a newer native token is not a skipped field"
        );
        assert_eq!(
            read_marker(&dir.0),
            serde_json::json!({ "count": 1, "deviceId": DEVICE })
        );
    }

    #[test]
    fn a_save_fills_only_its_listed_fields_that_are_missing() {
        let dir = Scratch::new("save-fill");
        let secrets = fake_keychain(&store());
        secrets
            .write(
                INDEX,
                r#"{"source":"save","keys":["plainToken","otherToken"]}"#,
            )
            .expect("save index");
        secrets
            .write("device-secrets/plainToken", "typed")
            .expect("typed value");
        let row = old_row(r#"{"plainToken":"old","otherToken":"g"}"#);
        move_now(&secrets, &dir.0, &[row]).expect("moves");
        assert_eq!(
            secrets.read("device-secrets/plainToken").expect("read"),
            Some("typed".to_owned())
        );
        assert_eq!(
            secrets.read("device-secrets/otherToken").expect("read"),
            Some("g".to_owned())
        );
        let index: Value =
            serde_json::from_str(&secrets.read(INDEX).expect("read").expect("index kept"))
                .expect("index is JSON");
        assert_eq!(index["source"], "save");
        assert_eq!(
            index["keys"],
            serde_json::json!(["plainToken", "otherToken"])
        );
        assert_eq!(
            read_marker(&dir.0),
            serde_json::json!({ "count": 1, "deviceId": DEVICE })
        );
    }

    #[test]
    fn an_index_over_the_cap_is_refused_before_any_field_is_written() {
        let dir = Scratch::new("index-too-long");
        let secrets = fake_keychain(&store());
        // Each field is small, but 300 sub-keys make the index body larger than the 2560-byte cap.
        let subs: Vec<String> = (0..300).map(|i| format!("\"s{i:04}\":\"1\"")).collect();
        let row = old_row(&format!(r#"{{"plainToken":{{{}}}}}"#, subs.join(",")));
        assert!(matches!(
            move_now(&secrets, &dir.0, &[row]),
            Err(SecretError::TooLong)
        ));
        assert_eq!(
            secrets
                .read("device-secrets/plainToken.s0000")
                .expect("read"),
            None
        );
        assert_eq!(secrets.read(INDEX).expect("read"), None);
        assert!(!marker_path(&dir.0, DEVICE).exists());
    }

    #[test]
    fn a_marker_with_a_cleared_keychain_moves_the_rows_again() {
        let dir = Scratch::new("cleared-keychain");
        record_secrets_moved(&dir.0, DEVICE, 1, &[]).expect("marker");
        // An empty keychain: the index and every field were cleared after the marker was written.
        let secrets = fake_keychain(&store());
        move_now(&secrets, &dir.0, &[old_row(r#"{"plainToken":"tok"}"#)]).expect("moves again");
        assert_eq!(
            secrets.read("device-secrets/plainToken").expect("read"),
            Some("tok".to_owned())
        );
        let index = secrets.read(INDEX).expect("read").expect("index rewritten");
        assert!(index.contains("plainToken"));
    }

    #[test]
    fn a_leftover_part_file_is_removed_and_no_part_is_left_behind() {
        let dir = Scratch::new("leftover-part");
        let part = marker_path(&dir.0, DEVICE).with_extension("json.part");
        fs::create_dir_all(part.parent().expect("folder")).expect("folder");
        fs::write(&part, b"{\"count\": 9, \"partial").expect("leftover");
        let secrets = fake_keychain(&store());
        move_now(&secrets, &dir.0, &[old_row(r#"{"plainToken":"tok"}"#)]).expect("moves");
        assert_eq!(
            read_marker(&dir.0),
            serde_json::json!({ "count": 1, "deviceId": DEVICE })
        );
        assert!(
            !part.exists(),
            "the .part file is renamed away, not left behind"
        );
    }

    #[test]
    fn concurrent_marker_writes_all_succeed_and_leave_one_marker() {
        use std::sync::{Arc, Barrier};
        for round in 0..30 {
            let dir = Scratch::new(&format!("marker-race-{round}"));
            let barrier = Arc::new(Barrier::new(8));
            let handles: Vec<_> = (0..8)
                .map(|_| {
                    let (folder, barrier) = (dir.0.clone(), Arc::clone(&barrier));
                    std::thread::spawn(move || {
                        let _ = barrier.wait();
                        record_secrets_moved(&folder, DEVICE, 1, &[])
                    })
                })
                .collect();
            for handle in handles {
                handle
                    .join()
                    .expect("thread")
                    .expect("every marker write succeeds");
            }
            assert_eq!(
                read_marker(&dir.0),
                serde_json::json!({ "count": 1, "deviceId": DEVICE })
            );
        }
    }

    #[test]
    fn a_legacy_token_routes_to_its_own_entry_and_is_never_indexed() {
        let dir = Scratch::new("route-token");
        let secrets = fake_keychain(&store());
        let row = old_row(r#"{"overleafToken":"tok","gitSyncToken":"g","notesToken":"n"}"#);
        move_now(&secrets, &dir.0, &[row]).expect("moves");
        assert_eq!(
            secrets.read("overleaf-token").expect("read"),
            Some("tok".to_owned())
        );
        assert_eq!(
            secrets.read("git-sync-token").expect("read"),
            Some("g".to_owned())
        );
        assert_eq!(
            secrets.read("device-secrets/overleafToken").expect("read"),
            None
        );
        let index: Value =
            serde_json::from_str(&secrets.read(INDEX).expect("read").expect("index"))
                .expect("json");
        assert_eq!(index["keys"], serde_json::json!(["notesToken"]));
    }

    #[test]
    fn a_write_only_key_that_cannot_route_is_skipped_and_only_its_name_is_returned() {
        let dir = Scratch::new("skip-token");
        let secrets = fake_keychain(&store());
        let row = old_row(r#"{"overleafToken":{"extra":"SECRET-SUB"},"notesToken":"n"}"#);
        let skipped = move_into_keychain(&secrets, &dir.0, DEVICE, &[row]).expect("moves");
        assert_eq!(skipped, vec!["overleafToken.extra".to_owned()]);
        // The marker keeps the unmoved names (never values) so a status view can list them.
        assert_eq!(
            read_marker(&dir.0),
            serde_json::json!({
                "count": 1,
                "deviceId": DEVICE,
                "unmoved": ["overleafToken.extra"],
            })
        );
        let index = secrets.read(INDEX).expect("read").expect("index");
        assert!(!index.contains("overleafToken") && !index.contains("SECRET-SUB"));
        assert_eq!(
            secrets
                .read("device-secrets/overleafToken.extra")
                .expect("read"),
            None
        );
    }

    #[test]
    fn a_partial_keychain_failure_is_retried_to_all_fields_and_the_index() {
        let dir = Scratch::new("partial-retry");
        let st = store();
        // The second field (in key order, plainToken) fails once; otherToken is already written.
        inject(
            &st,
            "device-secrets/plainToken",
            keyring_core::Error::NoStorageAccess("locked".into()),
        );
        let secrets = fake_keychain(&st);
        let rows = [old_row(r#"{"otherToken":"g","plainToken":"tok"}"#)];
        assert!(move_now(&secrets, &dir.0, &rows).is_err());
        assert!(!marker_path(&dir.0, DEVICE).exists());
        // No index was written, so the retry is a full move again.
        move_now(&secrets, &dir.0, &rows).expect("retry moves everything");
        assert_eq!(
            secrets.read("device-secrets/otherToken").expect("read"),
            Some("g".to_owned())
        );
        assert_eq!(
            secrets.read("device-secrets/plainToken").expect("read"),
            Some("tok".to_owned())
        );
        let index: Value =
            serde_json::from_str(&secrets.read(INDEX).expect("read").expect("index written"))
                .expect("index is JSON");
        assert_eq!(index["source"], "move");
        assert_eq!(index["keys"].as_array().expect("keys").len(), 2);
        assert_eq!(
            read_marker(&dir.0),
            serde_json::json!({ "count": 1, "deviceId": DEVICE })
        );
    }

    #[test]
    fn a_device_copy_matching_the_native_token_is_cleared_after_the_move() {
        let dir = Scratch::new("copy-same");
        let secrets = fake_keychain(&store());
        secrets.write("git-sync-token", "tok").expect("native");
        secrets
            .write("device-secrets/gitSyncToken", "tok")
            .expect("copy");
        move_now(&secrets, &dir.0, &[old_row(r#"{"gitSyncToken":"tok"}"#)]).expect("moves");
        assert_eq!(
            secrets.read("device-secrets/gitSyncToken").expect("read"),
            None
        );
        assert_eq!(
            secrets.read("git-sync-token").expect("read").as_deref(),
            Some("tok")
        );
        assert_eq!(read_marker(&dir.0)["count"], 1);
    }

    #[test]
    fn a_device_copy_that_differs_from_the_native_token_is_kept() {
        let dir = Scratch::new("copy-differs");
        let secrets = fake_keychain(&store());
        secrets.write("git-sync-token", "newer").expect("native");
        secrets
            .write("device-secrets/gitSyncToken", "old")
            .expect("copy");
        move_now(&secrets, &dir.0, &[old_row(r#"{"gitSyncToken":"old"}"#)]).expect("moves");
        assert_eq!(
            secrets
                .read("device-secrets/gitSyncToken")
                .expect("read")
                .as_deref(),
            Some("old")
        );
        assert_eq!(
            secrets.read("git-sync-token").expect("read").as_deref(),
            Some("newer")
        );
    }

    #[test]
    fn nothing_is_cleared_when_the_move_is_not_verified() {
        let dir = Scratch::new("copy-unverified");
        let secrets = fake_keychain(&store());
        secrets.write("git-sync-token", "tok").expect("native");
        secrets
            .write("device-secrets/gitSyncToken", "tok")
            .expect("copy");
        // Two rows are refused before anything is written, so the move is not verified.
        let rows = [old_row(r#"{"gitSyncToken":"tok"}"#), old_row(r#"{}"#)];
        assert_eq!(
            move_now(&secrets, &dir.0, &rows),
            Err(SecretError::SeveralRows)
        );
        assert_eq!(
            secrets
                .read("device-secrets/gitSyncToken")
                .expect("read")
                .as_deref(),
            Some("tok")
        );
        assert_eq!(
            secrets.read("git-sync-token").expect("read").as_deref(),
            Some("tok")
        );
    }

    #[test]
    fn a_newer_native_token_survives_an_old_db_token_on_the_move() {
        let dir = Scratch::new("newer-native");
        let secrets = fake_keychain(&store());
        // github_connect.rs wrote a fresh git-sync token after the old row was saved.
        secrets
            .write("git-sync-token", "newer")
            .expect("native token");
        let row = old_row(r#"{"gitSyncToken":"old"}"#);
        move_now(&secrets, &dir.0, &[row]).expect("moves");
        assert_eq!(
            secrets.read("git-sync-token").expect("read"),
            Some("newer".to_owned())
        );
    }

    #[test]
    fn an_old_save_index_listing_write_only_names_is_stripped_and_keeps_its_source() {
        let dir = Scratch::new("strip-save");
        let secrets = fake_keychain(&store());
        // An index written before the routing fix listed the write-only names.
        let old = r#"{"source":"save","keys":["plainToken","overleafToken","gitSyncToken.sub"]}"#;
        secrets.write(INDEX, old).expect("old index");
        secrets
            .write("device-secrets/plainToken", "typed")
            .expect("typed value");
        move_now(&secrets, &dir.0, &[old_row(r#"{"plainToken":"old"}"#)]).expect("save no-op");
        let index: Value =
            serde_json::from_str(&secrets.read(INDEX).expect("read").expect("index"))
                .expect("index is JSON");
        assert_eq!(
            index,
            serde_json::json!({ "source": "save", "keys": ["plainToken"] })
        );
    }

    #[test]
    fn a_marker_run_strips_write_only_names_from_an_old_move_index() {
        let dir = Scratch::new("strip-marker");
        let secrets = fake_keychain(&store());
        move_now(&secrets, &dir.0, &[old_row(r#"{"plainToken":"tok"}"#)]).expect("first move");
        // A build before the fix left a write-only entry and listed it in the index.
        secrets
            .write("device-secrets/overleafToken", "tok")
            .expect("old entry");
        secrets
            .write(
                INDEX,
                r#"{"source":"move","keys":["plainToken","overleafToken"]}"#,
            )
            .expect("old index");
        move_now(&secrets, &dir.0, &[old_row(r#"{"plainToken":"tok"}"#)]).expect("marker no-op");
        let index: Value =
            serde_json::from_str(&secrets.read(INDEX).expect("read").expect("index"))
                .expect("index is JSON");
        assert_eq!(
            index,
            serde_json::json!({ "source": "move", "keys": ["plainToken"] })
        );
    }
}
