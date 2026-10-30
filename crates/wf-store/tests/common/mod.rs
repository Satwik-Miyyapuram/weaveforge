//! Helpers shared by every wf-store integration test (plan §4.7: one copy per crate).
//!
//! Each test file declares it as `#[cfg(test)] mod common;` so clippy treats the helpers'
//! unwraps as test code.
#![allow(dead_code, reason = "each test file uses a different subset")]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static SEQ: AtomicU64 = AtomicU64::new(0);

/// A fresh, uniquely named folder under the system temp dir, removed on drop.
pub struct TempDir(PathBuf);

impl TempDir {
    pub fn new() -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("wf-store-{}-{nanos}-{seq}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Write `bytes` to `path`, creating its parent folders.
pub fn put(path: &Path, bytes: &[u8]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, bytes).unwrap();
}

/// Create a folder and its parents.
pub fn mkdir(path: &Path) {
    fs::create_dir_all(path).unwrap();
}

/// A directory link at `link` pointing to `target`; false when this machine cannot make one.
///
/// Windows uses a junction, which needs no admin rights or developer mode.
pub fn make_dir_link(link: &Path, target: &Path) -> bool {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link).is_ok()
    }
    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .status()
            .is_ok_and(|status| status.success())
    }
}
