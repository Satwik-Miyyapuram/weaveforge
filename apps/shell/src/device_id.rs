//! This machine's id for the 0.9.7 migration: a random 64-char hex string kept in
//! `<app data>/device-id`. Written once. A corrupt file is an error and is never regenerated,
//! so reports written by this device keep matching it.

use std::fs;
use std::io;
use std::path::Path;

const FILE: &str = "device-id";

/// Returns the stored id, creating the file on first use.
pub fn get_or_create(dir: &Path) -> io::Result<String> {
    let path = dir.join(FILE);
    match fs::read_to_string(&path) {
        Ok(text) => {
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
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            fs::create_dir_all(dir)?;
            let id = new_id(dir);
            fs::write(&path, &id)?;
            Ok(id)
        }
        Err(e) => Err(e),
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
