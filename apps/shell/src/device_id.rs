//! This machine's id for the 0.9.7 migration, read from `<app data>/device-id`. Read-only: the
//! 0.9.7 migration writes the file, and a missing file is `None` here, never a new id. A corrupt
//! file is an error, so a report written by this device is never silently mismatched.

use std::fs;
use std::io;
use std::path::Path;

const FILE: &str = "device-id";

/// The stored id, or `None` when the file is missing.
pub fn read_existing(dir: &Path) -> io::Result<Option<String>> {
    let path = dir.join(FILE);
    match fs::read_to_string(&path) {
        Ok(text) => {
            let id = text.trim();
            if is_valid(id) {
                Ok(Some(id.to_owned()))
            } else {
                Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("device id file is corrupt: {}", path.display()),
                ))
            }
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

fn is_valid(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::read_existing;

    const ID: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("wf-devid-read-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_file_is_none_and_is_not_created() {
        let dir = dir("missing");
        assert_eq!(read_existing(&dir).unwrap(), None);
        assert!(!dir.join("device-id").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stored_id_is_read() {
        let dir = dir("stored");
        std::fs::write(dir.join("device-id"), format!("{ID}\n")).unwrap();
        assert_eq!(read_existing(&dir).unwrap().as_deref(), Some(ID));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_id_is_an_error_and_is_left_alone() {
        let dir = dir("corrupt");
        std::fs::write(dir.join("device-id"), "not-hex").unwrap();
        assert!(read_existing(&dir).is_err());
        assert_eq!(std::fs::read_to_string(dir.join("device-id")).unwrap(), "not-hex");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
