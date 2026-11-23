//! This machine's id from the 0.9.7 migration: a 64-char hex string in `<app data>/device-id`.
//! 0.9.7 wrote it once; 0.9.8 only reads it. A corrupt file is an error, so a report written by
//! this device is never silently mismatched.

use std::fs;
use std::io;
use std::path::Path;

const FILE: &str = "device-id";

/// The stored id, read-only: a missing or empty file is `None` and is never created. A corrupt
/// file is an error, so a report written by this device is never silently mismatched.
pub fn read_existing(dir: &Path) -> io::Result<Option<String>> {
    let path = dir.join(FILE);
    match fs::read_to_string(&path) {
        Ok(text) if text.trim().is_empty() => Ok(None),
        Ok(text) => parse_id(&path, text.trim()).map(Some),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// The stored id if the file holds a valid one, else `None`. Never writes: a missing, empty or
/// corrupt file gives `None`, so the update hold stays closed instead of creating an id.
#[must_use]
pub fn get_existing(dir: &Path) -> Option<String> {
    read_existing(dir).ok().flatten()
}

fn parse_id(path: &Path, id: &str) -> io::Result<String> {
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

#[cfg(test)]
mod tests {
    #[test]
    fn read_existing_never_creates_and_rejects_corrupt_ids() {
        use super::read_existing;
        let dir = std::env::temp_dir().join(format!("wf-devid-read-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("device-id");
        assert_eq!(read_existing(&dir).unwrap(), None, "missing file");
        assert!(!path.exists(), "a read never creates the file");
        std::fs::write(&path, "  \n").unwrap();
        assert_eq!(read_existing(&dir).unwrap(), None, "empty leftover");
        let id = "ef".repeat(32);
        std::fs::write(&path, format!("{id}\n")).unwrap();
        assert_eq!(read_existing(&dir).unwrap().as_deref(), Some(id.as_str()));
        std::fs::write(&path, "not-an-id").unwrap();
        assert!(read_existing(&dir).is_err(), "corrupt id is an error");
        assert_eq!(super::get_existing(&dir), None, "corrupt id gives no id");
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(read_existing(&dir).unwrap(), None, "missing folder");
    }
}
