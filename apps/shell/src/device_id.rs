//! This machine's id for the 0.9.7 migration: a random 64-char hex string kept in
//! `<app data>/device-id`. Written once. A corrupt file is an error and is never regenerated,
//! so reports written by this device keep matching it.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

const FILE: &str = "device-id";

/// Returns the stored id, creating the file on first use.
pub fn get_or_create(dir: &Path) -> io::Result<String> {
    let path = dir.join(FILE);
    match read_id(&path) {
        Ok(id) => Ok(id),
        Err(e) if e.kind() == io::ErrorKind::NotFound => create(dir, &path),
        Err(e) => Err(e),
    }
}

/// Creates the file with `create_new`, so two first calls cannot both write. When another call
/// created it first, that call's id is read back.
fn create(dir: &Path, path: &Path) -> io::Result<String> {
    fs::create_dir_all(dir)?;
    let id = new_id(dir);
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(mut file) => {
            file.write_all(id.as_bytes())?;
            file.sync_all()?;
            Ok(id)
        }
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => read_id(path),
        Err(e) => Err(e),
    }
}

fn read_id(path: &Path) -> io::Result<String> {
    let text = fs::read_to_string(path)?;
    let id = text.trim();
    if is_valid(id) {
        Ok(id.to_owned())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("device id file is corrupt: {}", path.display()),
        ))
    }
}

fn is_valid(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

fn new_id(dir: &Path) -> String {
    use sha2::{Digest, Sha256};
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut hasher = Sha256::new();
    hasher.update(dir.to_string_lossy().as_bytes());
    hasher.update(nanos.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::get_or_create;

    #[test]
    fn creates_once_then_reuses_the_same_id() {
        let dir = std::env::temp_dir().join(format!("wf-devid-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let first = get_or_create(&dir).expect("first call creates");
        let second = get_or_create(&dir).expect("second call reads");
        assert_eq!(first, second);
        assert_eq!(first.len(), 64);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_id_file_is_an_error_and_is_not_regenerated() {
        let dir = std::env::temp_dir().join(format!("wf-devid-bad-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("device-id"), "not-hex").unwrap();
        assert!(get_or_create(&dir).is_err());
        assert_eq!(std::fs::read_to_string(dir.join("device-id")).unwrap(), "not-hex");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
