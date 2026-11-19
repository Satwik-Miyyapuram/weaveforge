//! Per-document append-only update log on disk. Each record is a u32 LE length, then the bytes.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// File extension of a document's log.
const EXT: &str = ".ylog";

/// The log file for `item_id` under `dir` (the id's bytes, as lowercase hex).
#[must_use]
pub fn log_path(dir: &Path, item_id: &str) -> PathBuf {
    let hex: String = item_id.bytes().map(|b| format!("{b:02x}")).collect();
    dir.join(format!("{hex}{EXT}"))
}

/// The item id a log file belongs to; `None` for any other file.
#[must_use]
pub fn item_from_path(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let hex = name.strip_suffix(EXT)?;
    if hex.len() % 2 != 0 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let bytes = hex
        .as_bytes()
        .chunks(2)
        .map(|pair| {
            std::str::from_utf8(pair)
                .ok()
                .and_then(|digits| u8::from_str_radix(digits, 16).ok())
        })
        .collect::<Option<Vec<u8>>>()?;
    String::from_utf8(bytes).ok()
}

/// The item ids that have a log file in `dir`, sorted. Empty if `dir` is missing.
pub fn list_logs(dir: &Path) -> io::Result<Vec<String>> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err),
    };
    let mut items = Vec::new();
    for entry in entries {
        if let Some(item) = item_from_path(&entry?.path()) {
            items.push(item);
        }
    }
    items.sort();
    Ok(items)
}

/// An open update log for one document.
pub struct UpdateLog {
    path: PathBuf,
    file: File,
}

impl UpdateLog {
    /// Opens the log for `item_id` under `dir`, creating it (and `dir`) if needed.
    pub fn open(dir: &Path, item_id: &str) -> io::Result<Self> {
        fs::create_dir_all(dir)?;
        let path = log_path(dir, item_id);
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .read(true)
            .open(&path)?;
        Ok(Self { path, file })
    }

    /// Appends one update and fsyncs it.
    pub fn append(&mut self, update: &[u8]) -> io::Result<()> {
        let len = u32::try_from(update.len()).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidInput, "update longer than u32::MAX")
        })?;
        // One write, so a crash leaves at most a torn record at the tail.
        let mut record = Vec::with_capacity(4 + update.len());
        record.extend_from_slice(&len.to_le_bytes());
        record.extend_from_slice(update);
        self.file.write_all(&record)?;
        self.file.sync_data()
    }

    /// Every complete update in the file, in order; a torn tail is ignored.
    pub fn read_all(&self) -> io::Result<Vec<Vec<u8>>> {
        let bytes = fs::read(&self.path)?;
        let mut out = Vec::new();
        let mut rest: &[u8] = &bytes;
        while let Some((head, tail)) = rest.split_first_chunk::<4>() {
            let len = usize::try_from(u32::from_le_bytes(*head)).unwrap_or(usize::MAX);
            if tail.len() < len {
                break;
            }
            let (body, next) = tail.split_at(len);
            out.push(body.to_vec());
            rest = next;
        }
        Ok(out)
    }

    /// Empties the log, after its updates are saved.
    pub fn truncate(&mut self) -> io::Result<()> {
        // An append-only handle cannot set_len on Windows, so truncate through a write handle.
        let file = OpenOptions::new().write(true).open(&self.path)?;
        file.set_len(0)?;
        file.sync_data()
    }

    /// Deletes the log file; a log that is already gone is fine.
    pub fn remove(self) -> io::Result<()> {
        let Self { path, file } = self;
        drop(file);
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(err),
        }
    }
}
