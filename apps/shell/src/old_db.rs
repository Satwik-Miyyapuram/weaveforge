//! Read-only access to the old PGlite data dir, for the one-time import. The dir is only ever
//! read: files are opened for reading, never created, written or renamed.

use std::fs;
use std::io;
use std::path::Path;
use std::time::SystemTime;

/// PGlite 0.5.x runs PostgreSQL 17. A dir written by another major version cannot be read by it.
pub const SUPPORTED_PG_MAJOR: &str = "17";

/// A ustar tar of the dir's files and folders, as PGlite's `loadDataDir` reads it. Paths are
/// relative to `root`; entries are sorted so the output is stable.
pub fn archive(root: &Path) -> io::Result<Vec<u8>> {
    let mut entries = Vec::new();
    collect(root, root, &mut entries)?;
    entries.sort();
    let mut out = Vec::new();
    for (name, is_dir) in entries {
        let path = root.join(&name);
        if is_dir {
            out.extend_from_slice(&header(&name, 0, 0, b'5')?);
            continue;
        }
        let data = fs::read(&path)?;
        let mtime = fs::metadata(&path)?
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs());
        out.extend_from_slice(&header(&name, data.len() as u64, mtime, b'0')?);
        out.extend_from_slice(&data);
        out.resize(out.len().next_multiple_of(512), 0);
    }
    out.resize(out.len() + 1024, 0);
    Ok(out)
}

/// Reads the old dir at `dir` as a tar for PGlite. Refuses a missing dir and a dir from another
/// PostgreSQL major, so the caller can show why and keep the old dir.
pub fn read_old_db(dir: &Path) -> io::Result<Vec<u8>> {
    let version = fs::read_to_string(dir.join("PG_VERSION")).map_err(|_| {
        io::Error::new(
            io::ErrorKind::NotFound,
            format!("no old local database at {}", dir.display()),
        )
    })?;
    let major = version.trim();
    if major != SUPPORTED_PG_MAJOR {
        return Err(io::Error::other(format!(
            "the old local database at {} is PostgreSQL {major}; this WeaveForge reads PostgreSQL {SUPPORTED_PG_MAJOR} only",
            dir.display()
        )));
    }
    archive(dir)
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<(String, bool)>) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = path
            .strip_prefix(root)
            .map_err(io::Error::other)?
            .to_string_lossy()
            .replace('\\', "/");
        let kind = entry.file_type()?;
        if kind.is_dir() {
            out.push((name, true));
            collect(root, &path, out)?;
        } else if kind.is_file() {
            out.push((name, false));
        }
        // Links and other special files are not part of a PGlite dir; they are skipped.
    }
    Ok(())
}

/// One 512-byte ustar header.
fn header(name: &str, size: u64, mtime: u64, kind: u8) -> io::Result<[u8; 512]> {
    if name.len() > 100 {
        return Err(io::Error::other(format!("path too long for tar: {name}")));
    }
    let mut h = [0u8; 512];
    h[..name.len()].copy_from_slice(name.as_bytes());
    let mode: &[u8] = if kind == b'5' { b"0000755" } else { b"0000644" };
    h[100..100 + mode.len()].copy_from_slice(mode);
    h[100 + mode.len()] = 0;
    put_octal(&mut h[108..116], 0); // uid
    put_octal(&mut h[116..124], 0); // gid
    put_octal(&mut h[124..136], size);
    put_octal(&mut h[136..148], mtime);
    h[156] = kind;
    h[257..263].copy_from_slice(b"ustar\0");
    h[263..265].copy_from_slice(b"00");
    // The checksum counts the field itself as spaces.
    h[148..156].copy_from_slice(b"        ");
    let sum: u32 = h.iter().map(|b| u32::from(*b)).sum();
    let check = format!("{sum:06o}\0 ");
    h[148..156].copy_from_slice(check.as_bytes());
    Ok(h)
}

/// Writes `value` as zero-padded octal, NUL-terminated, into `field`.
fn put_octal(field: &mut [u8], value: u64) {
    let digits = field.len() - 1;
    let text = format!("{value:0digits$o}");
    field[..digits].copy_from_slice(text.as_bytes());
    field[digits] = 0;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wf-old-db-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The files and folders in a tar: name to contents (`None` for a folder).
    fn parse(tar: &[u8]) -> BTreeMap<String, Option<Vec<u8>>> {
        let mut out = BTreeMap::new();
        let mut at = 0;
        while at + 512 <= tar.len() && tar[at] != 0 {
            let h = &tar[at..at + 512];
            let name = String::from_utf8_lossy(&h[..100]).trim_end_matches('\0').to_string();
            let size_text = String::from_utf8_lossy(&h[124..135]).to_string();
            let size = u64::from_str_radix(&size_text, 8).unwrap() as usize;
            let body = &tar[at + 512..at + 512 + size];
            let value = if h[156] == b'5' { None } else { Some(body.to_vec()) };
            out.insert(name, value);
            at += 512 + size.next_multiple_of(512);
        }
        out
    }

    fn fixture(dir: &Path) {
        fs::write(dir.join("PG_VERSION"), "17\n").unwrap();
        fs::create_dir_all(dir.join("base/1")).unwrap();
        fs::write(dir.join("base/1/rows"), b"row data").unwrap();
        fs::create_dir_all(dir.join("pg_wal")).unwrap();
    }

    #[test]
    fn archive_holds_every_file_and_folder() {
        let dir = scratch("contents");
        fixture(&dir);
        let entries = parse(&archive(&dir).unwrap());
        assert_eq!(entries.get("PG_VERSION"), Some(&Some(b"17\n".to_vec())));
        assert_eq!(entries.get("base/1/rows"), Some(&Some(b"row data".to_vec())));
        assert_eq!(entries.get("base"), Some(&None));
        assert_eq!(entries.get("pg_wal"), Some(&None));
        assert_eq!(entries.len(), 5);
    }

    #[test]
    fn reading_leaves_the_old_dir_untouched() {
        let dir = scratch("untouched");
        fixture(&dir);
        let before = snapshot(&dir);
        let _ = read_old_db(&dir).unwrap();
        assert_eq!(snapshot(&dir), before);
    }

    /// Every path with its contents and modified time, for a before/after comparison.
    fn snapshot(dir: &Path) -> BTreeMap<String, (Vec<u8>, SystemTime)> {
        let mut out = BTreeMap::new();
        let mut stack = vec![dir.to_path_buf()];
        while let Some(d) = stack.pop() {
            for entry in fs::read_dir(&d).unwrap() {
                let p = entry.unwrap().path();
                if p.is_dir() {
                    stack.push(p);
                } else {
                    let meta = fs::metadata(&p).unwrap();
                    out.insert(p.display().to_string(), (fs::read(&p).unwrap(), meta.modified().unwrap()));
                }
            }
        }
        out
    }

    #[test]
    fn missing_dir_is_a_clear_error() {
        let dir = scratch("missing").join("local-db");
        let err = read_old_db(&dir).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
        assert!(err.to_string().starts_with("no old local database at"), "{err}");
    }

    #[test]
    fn other_pg_major_is_refused() {
        let dir = scratch("version");
        fixture(&dir);
        fs::write(dir.join("PG_VERSION"), "16\n").unwrap();
        let err = read_old_db(&dir).unwrap_err();
        assert!(err.to_string().contains("PostgreSQL 16"), "{err}");
    }
}