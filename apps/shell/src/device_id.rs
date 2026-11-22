//! This machine's id for the 0.9.7 migration: a random 64-char hex string kept in
//! `<app data>/device-id`. Written once. A corrupt file is an error and is never regenerated,
//! so reports written by this device keep matching it. An empty file is a crash leftover, not an
//! id, so it is regenerated.

use std::fs;
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

const FILE: &str = "device-id";

/// Returns the stored id, creating the file on first use.
pub fn get_or_create(dir: &Path) -> io::Result<String> {
    let path = dir.join(FILE);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e),
    };
    if text.trim().is_empty() {
        // Absent, or an empty leftover from a crash: clear any empty leftover so the new file can
        // take the name.
        remove_if_still_empty(&path)?;
        return create(dir, &path);
    }
    parse_id(&path, text.trim())
}

/// Removes `path` only if it is still empty. Another call may have linked an id in since this
/// call read the name, and that id must not be removed.
fn remove_if_still_empty(path: &Path) -> io::Result<()> {
    match fs::read_to_string(path) {
        Ok(text) if text.trim().is_empty() => match fs::remove_file(path) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        },
        Ok(_) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Writes the id to a temp file of its own, syncs it, then hard-links it to the final name. The
/// link fails when another call already created the name, and that call's id is read back. The
/// name is only ever bound to a complete file, so a crash cannot leave a partial id behind. Each
/// call has its own temp name, so concurrent calls never share an inode.
fn create(dir: &Path, path: &Path) -> io::Result<String> {
    fs::create_dir_all(dir)?;
    let id = new_id(dir);
    let part = part_path(path);
    {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&part)?;
        file.write_all(id.as_bytes())?;
        file.sync_all()?;
    }
    let linked = fs::hard_link(&part, path);
    let _ = fs::remove_file(&part);
    match linked {
        Ok(()) => {
            sync_dir(dir)?;
            Ok(id)
        }
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
            let text = fs::read_to_string(path)?;
            parse_id(path, text.trim())
        }
        Err(e) => Err(e),
    }
}

/// A temp name unique to this call: pid, nanos and a process-wide counter.
fn part_path(path: &Path) -> std::path::PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let name = format!("{FILE}.{}-{nanos}-{seq}.part", std::process::id());
    path.with_file_name(name)
}

/// Makes the new name durable. On Unix a link is only durable once the folder is synced; Windows
/// has no folder fsync, so there this does nothing.
fn sync_dir(dir: &Path) -> io::Result<()> {
    #[cfg(unix)]
    fs::File::open(dir)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
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
    fn concurrent_first_calls_agree_on_one_id() {
        use std::sync::{Arc, Barrier};
        for round in 0..30 {
            let dir = std::env::temp_dir()
                .join(format!("wf-devid-race-{}-{round}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            let barrier = Arc::new(Barrier::new(8));
            let handles: Vec<_> = (0..8)
                .map(|_| {
                    let (dir, barrier) = (dir.clone(), Arc::clone(&barrier));
                    std::thread::spawn(move || {
                        let _ = barrier.wait();
                        get_or_create(&dir)
                    })
                })
                .collect();
            let ids: Vec<String> = handles
                .into_iter()
                .map(|h| h.join().expect("thread").expect("creates"))
                .collect();
            let stored = std::fs::read_to_string(dir.join("device-id")).unwrap();
            assert!(
                ids.iter().all(|id| *id == stored),
                "every caller must return the stored id"
            );
            let _ = std::fs::remove_dir_all(&dir);
        }
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

    #[test]
    fn an_empty_id_file_is_regenerated() {
        let dir = std::env::temp_dir().join(format!("wf-devid-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("device-id"), "").unwrap();
        let id = get_or_create(&dir).expect("an empty file is regenerated");
        assert_eq!(id.len(), 64);
        assert_eq!(std::fs::read_to_string(dir.join("device-id")).unwrap(), id);
        assert!(!dir.join("device-id.part").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cleanup_removes_an_empty_leftover_but_never_a_real_id() {
        use super::remove_if_still_empty;
        let dir = std::env::temp_dir().join(format!("wf-devid-clean-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("device-id");
        std::fs::write(&path, "").unwrap();
        remove_if_still_empty(&path).unwrap();
        assert!(!path.exists(), "an empty leftover is removed");
        let real = "cd".repeat(32);
        std::fs::write(&path, &real).unwrap();
        remove_if_still_empty(&path).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), real, "a real id is kept");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn syncing_the_folder_after_a_link_needs_the_folder() {
        use super::sync_dir;
        let dir = std::env::temp_dir().join(format!("wf-devid-sync-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        sync_dir(&dir).expect("an existing folder syncs");
        let _ = std::fs::remove_dir_all(&dir);
        #[cfg(unix)]
        assert!(sync_dir(&dir).is_err(), "a missing folder cannot be synced on Unix");
    }

    #[test]
    fn a_valid_id_file_is_kept() {
        let dir = std::env::temp_dir().join(format!("wf-devid-keep-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let kept = "ab".repeat(32);
        std::fs::write(dir.join("device-id"), &kept).unwrap();
        assert_eq!(get_or_create(&dir).expect("kept"), kept);
        assert_eq!(std::fs::read_to_string(dir.join("device-id")).unwrap(), kept);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
