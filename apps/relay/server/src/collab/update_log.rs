//! Per-document append-only update log on disk. Each record is a u32 LE length, then the bytes.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// File extension of a document's log.
const EXT: &str = ".ylog";

/// Longest item id that may name a log file.
const MAX_ID_LEN: usize = 128;

/// Whether `item_id` may name a log file: 1 to 128 ASCII letters, digits, `-` or `_`.
#[must_use]
pub fn is_safe_item_id(item_id: &str) -> bool {
    !item_id.is_empty()
        && item_id.len() <= MAX_ID_LEN
        && item_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The log file for `item_id` under `dir` (the id's bytes, as lowercase hex). `None` when the
/// id is not safe to name a file from.
#[must_use]
pub fn log_path(dir: &Path, item_id: &str) -> Option<PathBuf> {
    if !is_safe_item_id(item_id) {
        return None;
    }
    let hex: String = item_id.bytes().map(|b| format!("{b:02x}")).collect();
    Some(dir.join(format!("{hex}{EXT}")))
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

/// The complete records at the start of `bytes`, and the byte length they span. Anything after
/// that is a torn record from a crash mid-append.
fn split_records(bytes: &[u8]) -> (Vec<Vec<u8>>, usize) {
    let mut out = Vec::new();
    let mut good = 0;
    let mut rest: &[u8] = bytes;
    while let Some((head, tail)) = rest.split_first_chunk::<4>() {
        let len = usize::try_from(u32::from_le_bytes(*head)).unwrap_or(usize::MAX);
        if tail.len() < len {
            break;
        }
        let (body, next) = tail.split_at(len);
        out.push(body.to_vec());
        good += 4 + len;
        rest = next;
    }
    (out, good)
}

/// Writes `tail` to a new `<log>.<nanos>.bad` file beside the log and fsyncs it. The name does
/// not end in `.ylog`, so the side file is never listed as a document log.
fn keep_aside(path: &Path, tail: &[u8]) -> io::Result<()> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let side = path.with_file_name(format!("{name}.{nanos}.bad"));
    let mut file = OpenOptions::new().write(true).create_new(true).open(side)?;
    file.write_all(tail)?;
    file.sync_all()
}

/// An open update log for one document.
pub struct UpdateLog {
    path: PathBuf,
    file: File,
}

impl UpdateLog {
    /// Opens the log for `item_id` under `dir`, creating it (and `dir`) if needed. A torn tail
    /// left by a crash is cut off first, so later appends follow complete records.
    pub fn open(dir: &Path, item_id: &str) -> io::Result<Self> {
        fs::create_dir_all(dir)?;
        let path = log_path(dir, item_id).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "item id is not a safe file name",
            )
        })?;
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .read(true)
            .open(&path)?;
        let bytes = fs::read(&path)?;
        let (_, good) = split_records(&bytes);
        if good < bytes.len() {
            // Records after a bad header cannot be framed again, so cutting drops them. Keep
            // the cut bytes beside the log first, so nothing is lost on disk.
            keep_aside(&path, &bytes[good..])?;
            let cut = OpenOptions::new().write(true).open(&path)?;
            cut.set_len(good as u64)?;
            cut.sync_data()?;
        }
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
        Ok(split_records(&bytes).0)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("ylog-{name}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir).expect("create scratch dir");
        dir
    }

    fn record(body: &[u8]) -> Vec<u8> {
        let len = u32::try_from(body.len()).expect("short body");
        let mut out = len.to_le_bytes().to_vec();
        out.extend_from_slice(body);
        out
    }

    #[test]
    fn mid_file_corruption_keeps_valid_prefix_and_moves_tail_aside() {
        let dir = scratch_dir("midfile");
        let path = log_path(&dir, "doc1").expect("safe id");
        // One good record, then a corrupt length header followed by a valid record.
        let bad_tail = [u32::MAX.to_le_bytes().to_vec(), record(b"xy")].concat();
        fs::write(&path, [record(b"abc"), bad_tail.clone()].concat()).expect("write log");

        let log = UpdateLog::open(&dir, "doc1").expect("open log");
        assert_eq!(fs::metadata(&path).expect("log meta").len(), 7);
        assert_eq!(log.read_all().expect("read"), vec![b"abc".to_vec()]);
        drop(log);

        // The cut bytes are kept in a side file, not discarded.
        let file_name = path
            .file_name()
            .expect("log name")
            .to_string_lossy()
            .into_owned();
        let sides: Vec<PathBuf> = fs::read_dir(&dir)
            .expect("list dir")
            .map(|entry| entry.expect("entry").path())
            .filter(|p| {
                let name = p.file_name().expect("name").to_string_lossy().into_owned();
                name.starts_with(&format!("{file_name}.")) && name.ends_with(".bad")
            })
            .collect();
        assert_eq!(sides.len(), 1, "expected one side file, got {sides:?}");
        assert_eq!(fs::read(&sides[0]).expect("read side file"), bad_tail);

        for side in &sides {
            fs::remove_file(side).expect("remove side file");
        }
        fs::remove_file(&path).expect("remove log");
        fs::remove_dir(&dir).expect("remove scratch dir");
    }
}
