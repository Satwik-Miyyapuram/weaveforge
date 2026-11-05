//! Offline attachment bytes on disk instead of in the database (step 5.3e).
//!
//! The page keeps a `local_blobs` row per file (content type, time); the bytes live here, one file
//! per `(bucket, path)`. A file's name is the SHA-256 of the pair, so no stored path is ever turned
//! into a file system path: there is nothing to escape, and Windows-reserved names cannot occur.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use sha2::{Digest, Sha256};

use crate::commands::ShellError;

/// Tauri-managed root of the offline files: `<app data>/local-files`.
#[derive(Debug, Clone)]
pub struct LocalFiles {
    root: PathBuf,
}

/// Gives each temp file a distinct name within one process.
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

impl LocalFiles {
    /// Files under `root`, which is made on the first write.
    #[must_use]
    pub const fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// `<root>/<first two hex>/<sha256 hex>` for one `(bucket, path)`.
    #[must_use]
    pub fn file_for(&self, bucket: &str, path: &str) -> PathBuf {
        let mut hash = Sha256::new();
        hash.update(bucket.as_bytes());
        hash.update([0]);
        hash.update(path.as_bytes());
        let hex: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
        self.root.join(&hex[..2]).join(hex)
    }

    /// The bytes, or `None` when there is no such file.
    ///
    /// # Errors
    /// The file exists but could not be read.
    pub fn read(&self, bucket: &str, path: &str) -> Result<Option<Vec<u8>>, String> {
        match std::fs::read(self.file_for(bucket, path)) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("could not read the offline file: {e}")),
        }
    }

    /// Writes the bytes whole: a temp file beside the target, then a rename over it, so a crash
    /// leaves the old bytes or the new ones, never half.
    ///
    /// # Errors
    /// The folder could not be made, or the write or rename failed.
    pub fn write(&self, bucket: &str, path: &str, bytes: &[u8]) -> Result<(), String> {
        let file = self.file_for(bucket, path);
        let dir = file.parent().unwrap_or(&self.root);
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("could not make the offline files folder: {e}"))?;
        let temp = temp_beside(&file);
        let written = std::fs::write(&temp, bytes).and_then(|()| std::fs::rename(&temp, &file));
        if let Err(e) = written {
            let _ = std::fs::remove_file(&temp);
            return Err(format!("could not write the offline file: {e}"));
        }
        Ok(())
    }

    /// Removes the file; a missing one is not an error.
    ///
    /// # Errors
    /// The file exists but could not be removed.
    pub fn remove(&self, bucket: &str, path: &str) -> Result<(), String> {
        match std::fs::remove_file(self.file_for(bucket, path)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("could not remove the offline file: {e}")),
        }
    }
}

/// `<file>.<pid>-<n>.tmp`, in the same folder so the rename stays on one volume.
fn temp_beside(file: &Path) -> PathBuf {
    let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut name = file.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".{}-{n}.tmp", std::process::id()));
    file.with_file_name(name)
}

/// Runs a file step off the async runtime.
async fn blocking<T: Send + 'static>(
    step: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, ShellError> {
    tokio::task::spawn_blocking(step)
        .await
        .map_err(|e| format!("offline file task failed: {e}"))?
        .map_err(ShellError::from)
}

/// Reads one offline file as standard base64; `null` when it is missing.
#[tauri::command]
#[specta::specta]
pub async fn local_file_read(
    files: tauri::State<'_, LocalFiles>,
    bucket: String,
    path: String,
) -> Result<Option<String>, ShellError> {
    let files = files.inner().clone();
    let bytes = blocking(move || files.read(&bucket, &path)).await?;
    Ok(bytes.map(|b| STANDARD.encode(b)))
}

/// Writes one offline file from standard base64.
///
/// # Errors
/// Invalid base64, or the write failed.
#[tauri::command]
#[specta::specta]
pub async fn local_file_write(
    files: tauri::State<'_, LocalFiles>,
    bucket: String,
    path: String,
    bytes: String,
) -> Result<(), ShellError> {
    let bytes = crate::cmd_vault::decode_bytes(&bytes)?;
    let files = files.inner().clone();
    blocking(move || files.write(&bucket, &path, &bytes)).await
}

/// Removes one offline file; a missing one is fine.
#[tauri::command]
#[specta::specta]
pub async fn local_file_remove(
    files: tauri::State<'_, LocalFiles>,
    bucket: String,
    path: String,
) -> Result<(), ShellError> {
    let files = files.inner().clone();
    blocking(move || files.remove(&bucket, &path)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("wf-files-{tag}-{}-{n}", std::process::id()))
    }

    #[test]
    fn write_read_overwrite_remove() -> Result<(), String> {
        let root = temp("rw");
        let files = LocalFiles::new(root.clone());
        assert_eq!(files.read("b", "u/x.png")?, None);
        files.write("b", "u/x.png", &[0, 255, 1])?;
        assert_eq!(files.read("b", "u/x.png")?, Some(vec![0, 255, 1]));
        files.write("b", "u/x.png", b"new")?;
        assert_eq!(files.read("b", "u/x.png")?, Some(b"new".to_vec()));
        files.write("b", "u/empty", &[])?;
        assert_eq!(files.read("b", "u/empty")?, Some(Vec::new()));
        files.remove("b", "u/x.png")?;
        files.remove("b", "u/x.png")?;
        assert_eq!(files.read("b", "u/x.png")?, None);
        // No temp files are left behind.
        let left: Vec<_> = walk(&root)
            .into_iter()
            .filter(|p| p.extension().is_some_and(|e| e == "tmp"))
            .collect();
        assert!(left.is_empty(), "{left:?}");
        let _ = std::fs::remove_dir_all(&root);
        Ok(())
    }

    #[test]
    fn hostile_paths_stay_inside_the_root() {
        let root = temp("hostile");
        let files = LocalFiles::new(root.clone());
        for path in [
            "../../etc/passwd",
            "C:\\Windows\\x",
            "/abs",
            "CON",
            "a/./b",
            "",
            "trailing. ",
        ] {
            let file = files.file_for("vectors", path);
            assert_eq!(file.parent().and_then(Path::parent), Some(root.as_path()));
            let name = file.file_name().map(|n| n.to_string_lossy().into_owned());
            assert!(
                name.is_some_and(|n| n.len() == 64 && n.bytes().all(|b| b.is_ascii_hexdigit()))
            );
        }
    }

    #[test]
    fn bucket_and_path_never_collide() {
        let files = LocalFiles::new(PathBuf::from("r"));
        assert_ne!(files.file_for("ab", "c"), files.file_for("a", "bc"));
        assert_ne!(files.file_for("a", "b"), files.file_for("b", "a"));
        assert_eq!(files.file_for("a", "b"), files.file_for("a", "b"));
    }

    fn walk(dir: &Path) -> Vec<PathBuf> {
        let mut out = Vec::new();
        for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() {
                out.extend(walk(&path));
            } else {
                out.push(path);
            }
        }
        out
    }
}
