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

use serde_json::Value;
use tauri::Manager;

use crate::cmd_vault;
use crate::commands::{LocalDb, ShellError};
use crate::secrets::{DEVICE_SECRETS, SecretError, Secrets, is_device_field};
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
pub fn legacy_db_present(db: tauri::State<'_, LocalDb>) -> bool {
    db.legacy_db_present()
}

/// The inverse of `legacy_db_present`: true when the old database folder is missing, so the page's
/// legacy read can report "no old secrets" without an error.
#[tauri::command]
#[specta::specta]
pub fn legacy_dir_missing(db: tauri::State<'_, LocalDb>) -> bool {
    !db.legacy_db_present()
}

/// Moves the old rows into the keychain and records the move. The workspace folder is the vault
/// root on this side, never a value from the page. EXPORT calls it after the export is verified and
/// before remove-old.
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
) -> Result<(), ShellError> {
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
    // No legacy database folder means no old rows: a fresh install moves zero rows. A stopped or
    // unreadable database is an error, so the save that asked for the move is refused.
    let rows = if db.legacy_db_present() {
        db.query(READ_LOCAL_SECRETS_SQL.to_owned(), Vec::new()).await?
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
pub fn move_into_keychain(
    secrets: &Secrets,
    folder: &Path,
    device: &str,
    rows: &[Value],
) -> Result<(), SecretError> {
    if marker_matches(secrets, folder, device) {
        return Ok(());
    }
    if rows.len() > 1 {
        return Err(SecretError::SeveralRows);
    }
    let marker = || {
        record_secrets_moved(folder, device, rows.len()).map_err(|_| SecretError::MarkerFailed)
    };
    let fields = row_fields(rows)?;
    match index_source(secrets)? {
        IndexSource::Save => {
            // The saved values win: a field already in the keychain is kept, and only the old fields
            // it lacks are written. The index stays `save` and lists the union of keys.
            for (key, text) in &fields {
                if secrets.read(&field_name(key))?.is_none() {
                    secrets.write(&field_name(key), text)?;
                }
            }
            let mut keys = listed_keys(secrets)?;
            for (key, _) in &fields {
                if !keys.contains(key) {
                    keys.push(key.clone());
                }
            }
            write_index(secrets, "save", &keys)?;
            return marker();
        }
        IndexSource::Move | IndexSource::Absent => {}
    }
    store_fields(secrets, &fields)?;
    let keys: Vec<String> = fields.iter().map(|(key, _)| key.clone()).collect();
    write_index(secrets, "move", &keys)?;
    marker()
}

/// The `(key, text)` fields of the one old row, or none when there are no rows.
fn row_fields(rows: &[Value]) -> Result<Vec<(String, String)>, SecretError> {
    match rows.first() {
        None => Ok(Vec::new()),
        Some(row) => device_fields(row),
    }
}

/// The keys the index lists. Call only after `index_source` has read the index as valid.
fn listed_keys(secrets: &Secrets) -> Result<Vec<String>, SecretError> {
    let text = secrets.read(INDEX)?.unwrap_or_default();
    let index: Value = serde_json::from_str(&text).map_err(|_| SecretError::CorruptIndex)?;
    Ok(index["keys"]
        .as_array()
        .map(|keys| keys.iter().filter_map(|key| key.as_str().map(str::to_owned)).collect())
        .unwrap_or_default())
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
/// sub-key, named `<name>.<sub>` with its JSON text. Empty strings are not stored. Every field is
/// checked here, before the first keychain write.
fn device_fields(row: &Value) -> Result<Vec<(String, String)>, SecretError> {
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
    for (name, field) in map {
        // A dot is the separator between a name and its sub-key, and a leading `_` is reserved (the
        // index entry is `_index`), so a top-level name may hold neither.
        if name.contains('.') || name.starts_with('_') {
            return Err(SecretError::BadRow);
        }
        match field {
            Value::String(text) => push_field(&mut fields, name.clone(), text.clone())?,
            Value::Object(nested) => {
                for (sub, nested_value) in nested {
                    if nested_value.is_null() {
                        continue;
                    }
                    let key = format!("{name}.{}", sub_key(sub));
                    push_field(&mut fields, key, nested_value.to_string())?;
                }
            }
            _ => return Err(SecretError::BadRow),
        }
    }
    Ok(fields)
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
fn push_field(fields: &mut Vec<(String, String)>, key: String, text: String) -> Result<(), SecretError> {
    // `_index` is the index entry's own name; a credential under it would overwrite the index.
    if key == RESERVED_INDEX_KEY || !is_device_field(&field_name(&key)) {
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

/// One keychain write per field. The first failure is returned. The index is written last, so a
/// partial failure leaves no readable index and a retry rewrites every field.
fn store_fields(secrets: &Secrets, fields: &[(String, String)]) -> Result<(), SecretError> {
    for (key, text) in fields {
        secrets.write(&field_name(key), text)?;
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

/// Writes this device's marker, `{count, deviceId}`, atomically. `count` is the number of rows the
/// marker covers. The marker holds no secret value.
///
/// # Errors
/// Fails when the marker folder cannot be created or the marker cannot be written.
pub fn record_secrets_moved(folder: &Path, device: &str, count: usize) -> io::Result<()> {
    let body = serde_json::to_vec(&serde_json::json!({
        "count": count,
        "deviceId": device,
    }))
    .map_err(io::Error::other)?;
    write_atomic(&marker_path(folder, device), &body)
}

/// Writes `body` to `path` through `<path>.part`, synced before the rename. A leftover `.part` from
/// an earlier crash is removed first, so the file is always created fresh.
fn write_atomic(path: &Path, body: &[u8]) -> io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::other("the marker has no folder"))?;
    fs::create_dir_all(dir)?;
    let part = path.with_extension("json.part");
    match fs::remove_file(&part) {
        Ok(()) => {}
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => return Err(err),
    }
    {
        let mut file = File::create_new(&part)?;
        file.write_all(body)?;
        file.sync_all()?;
    }
    fs::rename(&part, path)
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
            let dir = std::env::temp_dir().join(format!(
                "wf-secrets-moved-{name}-{}",
                std::process::id()
            ));
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
        move_into_keychain(secrets, folder, DEVICE, rows)
    }

    #[test]
    fn all_rows_moved_writes_marker_with_count_one() {
        let dir = Scratch::new("all-moved");
        let secrets = fake_keychain(&store());
        move_now(&secrets, &dir.0, &[old_row(r#"{"overleafToken":"tok"}"#)]).expect("moves");
        assert_eq!(read_marker(&dir.0), serde_json::json!({ "count": 1, "deviceId": DEVICE }));
        assert_eq!(
            secrets.read("device-secrets/overleafToken").expect("read"),
            Some("tok".to_owned())
        );
    }

    #[test]
    fn one_keychain_failure_writes_no_marker() {
        let dir = Scratch::new("one-fail");
        let st = store();
        inject(
            &st,
            "device-secrets/overleafToken",
            keyring_core::Error::NoStorageAccess("locked".into()),
        );
        let secrets = fake_keychain(&st);
        let rows = [old_row(r#"{"overleafToken":"tok","gitSyncToken":"g"}"#)];
        assert!(move_now(&secrets, &dir.0, &rows).is_err());
        assert!(!marker_path(&dir.0, DEVICE).exists());
    }

    #[test]
    fn no_rows_writes_empty_move_index_and_count_zero() {
        let dir = Scratch::new("no-rows");
        let secrets = fake_keychain(&store());
        move_now(&secrets, &dir.0, &[]).expect("moves nothing");
        assert_eq!(read_marker(&dir.0)["count"], 0);
        let index: Value = serde_json::from_str(
            &secrets.read(INDEX).expect("read").expect("index written"),
        )
        .expect("index is JSON");
        assert_eq!(index["source"], "move");
        assert!(index["keys"].as_array().expect("keys").is_empty());
    }

    #[test]
    fn no_keychain_writes_no_marker() {
        let dir = Scratch::new("no-keychain");
        let secrets = Secrets::new(None, "test");
        let rows = [old_row(r#"{"overleafToken":"tok"}"#)];
        assert!(move_now(&secrets, &dir.0, &rows).is_err());
        assert!(!marker_path(&dir.0, DEVICE).exists());
    }

    #[test]
    fn locked_keychain_moves_nothing_and_writes_no_marker() {
        let dir = Scratch::new("locked");
        let st = store();
        inject(&st, INDEX, keyring_core::Error::NoStorageAccess("locked".into()));
        let secrets = fake_keychain(&st);
        let rows = [old_row(r#"{"overleafToken":"tok"}"#)];
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
            .write(INDEX, r#"{"source":"save","keys":["overleafToken"]}"#)
            .expect("save index");
        secrets
            .write("device-secrets/overleafToken", "typed")
            .expect("typed value");
        move_now(&secrets, &dir.0, &[old_row(r#"{"overleafToken":"old"}"#)])
            .expect("save on this device is a no-op move");
        assert_eq!(read_marker(&dir.0), serde_json::json!({ "count": 1, "deviceId": DEVICE }));
        assert_eq!(
            secrets.read("device-secrets/overleafToken").expect("read"),
            Some("typed".to_owned())
        );
    }

    #[test]
    fn a_marker_for_this_device_is_a_no_op() {
        let dir = Scratch::new("same-device");
        let secrets = fake_keychain(&store());
        // A marker is trusted only while the index and its fields are still in the keychain.
        secrets
            .write(INDEX, r#"{"source":"move","keys":["overleafToken"]}"#)
            .expect("index");
        secrets
            .write("device-secrets/overleafToken", "kept")
            .expect("field");
        record_secrets_moved(&dir.0, DEVICE, 1).expect("marker");
        move_now(&secrets, &dir.0, &[old_row(r#"{"overleafToken":"tok"}"#)]).expect("no-op");
        assert_eq!(
            secrets.read("device-secrets/overleafToken").expect("read"),
            Some("kept".to_owned())
        );
    }

    #[test]
    fn a_marker_for_another_device_does_not_count_as_moved() {
        let dir = Scratch::new("other-device");
        let secrets = fake_keychain(&store());
        record_secrets_moved(&dir.0, "device-b", 1).expect("marker");
        move_now(&secrets, &dir.0, &[old_row(r#"{"overleafToken":"tok"}"#)]).expect("moves here");
        assert_eq!(
            secrets.read("device-secrets/overleafToken").expect("read"),
            Some("tok".to_owned())
        );
        assert_eq!(read_marker(&dir.0), serde_json::json!({ "count": 1, "deviceId": DEVICE }));
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
        move_now(&secrets, &dir.0, &[old_row(r#"{"overleafToken":"tok"}"#)]).expect("moves here");
        assert_eq!(
            secrets.read("device-secrets/overleafToken").expect("read"),
            Some("tok".to_owned())
        );
    }

    #[test]
    fn an_unreadable_index_is_corrupt_and_nothing_is_moved() {
        let dir = Scratch::new("corrupt-index");
        let secrets = fake_keychain(&store());
        secrets.write(INDEX, "not json").expect("damaged index");
        assert!(matches!(
            move_now(&secrets, &dir.0, &[old_row(r#"{"overleafToken":"tok"}"#)]),
            Err(SecretError::CorruptIndex)
        ));
        assert_eq!(secrets.read("device-secrets/overleafToken").expect("read"), None);
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
        move_now(&secrets, &dir.0, &[old_row(r#"{"overleafToken":"tok"}"#)]).expect("moves");
        assert_eq!(read_marker(&dir.0)["count"], 1);
    }

    #[test]
    fn reset_leaves_a_readable_index_alone() {
        let secrets = fake_keychain(&store());
        secrets
            .write(INDEX, r#"{"source":"save","keys":["overleafToken"]}"#)
            .expect("save index");
        reset_corrupt_index(&secrets).expect("reset is a no-op");
        assert_eq!(
            secrets.read(INDEX).expect("read"),
            Some(r#"{"source":"save","keys":["overleafToken"]}"#.to_owned())
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
        let row = old_row(r#"{"overleafToken":"SECRET-VALUE-XYZ"}"#);
        move_now(&secrets, &dir.0, &[row]).expect("moves");
        let text = std::fs::read_to_string(marker_path(&dir.0, DEVICE)).expect("marker");
        assert!(!text.contains("SECRET-VALUE-XYZ"), "marker leaked a value: {text}");
    }

    #[test]
    fn a_row_whose_json_column_is_already_an_object_moves() {
        let dir = Scratch::new("object-row");
        let secrets = fake_keychain(&store());
        let row = serde_json::json!({ "secrets": { "overleafToken": "tok" } });
        move_now(&secrets, &dir.0, &[row]).expect("moves");
        assert_eq!(
            secrets.read("device-secrets/overleafToken").expect("read"),
            Some("tok".to_owned())
        );
    }

    #[test]
    fn an_odd_sub_key_is_hex_encoded_into_the_entry_name() {
        let dir = Scratch::new("odd-sub");
        let secrets = fake_keychain(&store());
        move_now(&secrets, &dir.0, &[old_row(r#"{"ai-provider":{"a b":"v"}}"#)]).expect("moves");
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
        let row = old_row(&format!(r#"{{"gitSyncToken":"small","overleafToken":"{big}"}}"#));
        assert!(matches!(
            move_now(&secrets, &dir.0, &[row]),
            Err(SecretError::TooLong)
        ));
        assert_eq!(
            secrets.read("device-secrets/gitSyncToken").expect("read"),
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
        let row = old_row(&format!(r#"{{"overleafToken":"{edge}"}}"#));
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
        assert_eq!(crate::device_id::get_or_create(&a.0).expect("reused"), first);
        assert_ne!(crate::device_id::get_or_create(&b.0).expect("created"), first);
    }

    #[test]
    fn a_save_keeps_the_saved_value_and_merges_the_old_fields_it_lacks() {
        let dir = Scratch::new("save-merge");
        let secrets = fake_keychain(&store());
        secrets
            .write(INDEX, r#"{"source":"save","keys":["overleafToken"]}"#)
            .expect("save index");
        secrets
            .write("device-secrets/overleafToken", "typed")
            .expect("typed value");
        let row = old_row(r#"{"overleafToken":"old","gitSyncToken":"g"}"#);
        move_now(&secrets, &dir.0, &[row]).expect("moves");
        assert_eq!(
            secrets.read("device-secrets/overleafToken").expect("read"),
            Some("typed".to_owned())
        );
        assert_eq!(
            secrets.read("device-secrets/gitSyncToken").expect("read"),
            Some("g".to_owned())
        );
        let index: Value = serde_json::from_str(
            &secrets.read(INDEX).expect("read").expect("index kept"),
        )
        .expect("index is JSON");
        assert_eq!(index["source"], "save");
        assert!(index["keys"].as_array().expect("keys").iter().any(|k| k == "gitSyncToken"));
        assert_eq!(read_marker(&dir.0), serde_json::json!({ "count": 1, "deviceId": DEVICE }));
    }

    #[test]
    fn a_marker_with_a_cleared_keychain_moves_the_rows_again() {
        let dir = Scratch::new("cleared-keychain");
        record_secrets_moved(&dir.0, DEVICE, 1).expect("marker");
        // An empty keychain: the index and every field were cleared after the marker was written.
        let secrets = fake_keychain(&store());
        move_now(&secrets, &dir.0, &[old_row(r#"{"overleafToken":"tok"}"#)]).expect("moves again");
        assert_eq!(
            secrets.read("device-secrets/overleafToken").expect("read"),
            Some("tok".to_owned())
        );
        let index = secrets.read(INDEX).expect("read").expect("index rewritten");
        assert!(index.contains("overleafToken"));
    }

    #[test]
    fn a_leftover_part_file_is_removed_and_no_part_is_left_behind() {
        let dir = Scratch::new("leftover-part");
        let part = marker_path(&dir.0, DEVICE).with_extension("json.part");
        fs::create_dir_all(part.parent().expect("folder")).expect("folder");
        fs::write(&part, b"{\"count\": 9, \"partial").expect("leftover");
        let secrets = fake_keychain(&store());
        move_now(&secrets, &dir.0, &[old_row(r#"{"overleafToken":"tok"}"#)]).expect("moves");
        assert_eq!(read_marker(&dir.0), serde_json::json!({ "count": 1, "deviceId": DEVICE }));
        assert!(!part.exists(), "the .part file is renamed away, not left behind");
    }

    #[test]
    fn a_partial_keychain_failure_is_retried_to_all_fields_and_the_index() {
        let dir = Scratch::new("partial-retry");
        let st = store();
        // The second field (in key order, overleafToken) fails once; gitSyncToken is already written.
        inject(
            &st,
            "device-secrets/overleafToken",
            keyring_core::Error::NoStorageAccess("locked".into()),
        );
        let secrets = fake_keychain(&st);
        let rows = [old_row(r#"{"gitSyncToken":"g","overleafToken":"tok"}"#)];
        assert!(move_now(&secrets, &dir.0, &rows).is_err());
        assert!(!marker_path(&dir.0, DEVICE).exists());
        // No index was written, so the retry is a full move again.
        move_now(&secrets, &dir.0, &rows).expect("retry moves everything");
        assert_eq!(
            secrets.read("device-secrets/gitSyncToken").expect("read"),
            Some("g".to_owned())
        );
        assert_eq!(
            secrets.read("device-secrets/overleafToken").expect("read"),
            Some("tok".to_owned())
        );
        let index: Value = serde_json::from_str(
            &secrets.read(INDEX).expect("read").expect("index written"),
        )
        .expect("index is JSON");
        assert_eq!(index["source"], "move");
        assert_eq!(index["keys"].as_array().expect("keys").len(), 2);
        assert_eq!(read_marker(&dir.0), serde_json::json!({ "count": 1, "deviceId": DEVICE }));
    }
}
