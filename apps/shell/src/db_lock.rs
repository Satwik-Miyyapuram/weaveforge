//! One process per data directory: a `<dir>.lock` file beside it, created exclusively, naming the holder.
//!
//! Same file format and rules as the removed Node sidecar's `local-db-lock.ts`, so the shell, 0.9 and the old
//! Electron app honour each other's locks. Two apps on one database directory each write WAL over the other's
//! (2026-10-08).

use std::ffi::OsString;
use std::fs;
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::local_http::control::parse_iso_ms;
use crate::vault::iso_utc;

/// How long an unreadable lock is given to be written: an exclusive create makes the file before its contents land.
const UNWRITTEN_GRACE: Duration = Duration::from_secs(5);

/// Who holds a lock, as written in the lock file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LockHolder {
    /// The holder's process id.
    pub pid: u32,
    /// The holder's name, shown to the user.
    pub app: String,
    /// When it took the lock (ISO-8601); `None` when the file has none.
    pub at: Option<String>,
}

/// Why a lock could not be taken.
#[derive(Debug, thiserror::Error)]
pub enum LockError {
    /// Another live process holds it.
    #[error("{} (pid {}) already has this database open: {}. Quit it, then try again.", holder.app, holder.pid, dir.display())]
    InUse {
        /// The locked data dir.
        dir: PathBuf,
        /// Who holds it.
        holder: LockHolder,
    },
    /// The lock file could not be read or written.
    #[error("{0}")]
    Io(#[from] io::Error),
}

/// `<dir>.lock`.
#[must_use]
pub fn lock_path(dir: &Path) -> PathBuf {
    let mut name = OsString::from(dir.as_os_str());
    name.push(".lock");
    PathBuf::from(name)
}

/// Takes the lock for this process, or fails with [`LockError::InUse`] naming who has it.
/// Taking it again from the same process is a no-op.
///
/// # Errors
/// [`LockError::InUse`] while another live process holds it; [`LockError::Io`] on any other I/O failure.
pub fn acquire(dir: &Path, app: &str, now: SystemTime) -> Result<(), LockError> {
    let file = lock_path(dir);
    let mine = serde_json::json!({ "pid": std::process::id(), "app": app, "at": iso_utc(now) })
        .to_string();
    for _ in 0..2 {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&file)
        {
            Ok(mut handle) => {
                handle.write_all(mine.as_bytes())?;
                return Ok(());
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.into()),
        }
        let holder = read_holder(&file);
        if holder.as_ref().is_some_and(|h| h.pid == std::process::id()) {
            return Ok(());
        }
        if !stale(&file, holder.as_ref(), now) {
            let holder = holder.unwrap_or_else(|| unwritten(&file));
            return Err(LockError::InUse {
                dir: dir.to_path_buf(),
                holder,
            });
        }
        take_over_stale(dir, &file, now)?;
    }
    Err(io::Error::other(format!(
        "could not take the database lock {}",
        file.display()
    ))
    .into())
}

/// Drops the lock if this process holds it; never someone else's.
pub fn release(dir: &Path) {
    let file = lock_path(dir);
    if read_holder(&file).is_some_and(|h| h.pid == std::process::id()) {
        let _ = fs::remove_file(file);
    }
}

/// The holder in `file`, or `None` when it cannot be read or has no numeric pid.
fn read_holder(file: &Path) -> Option<LockHolder> {
    let value: serde_json::Value = serde_json::from_str(&fs::read_to_string(file).ok()?).ok()?;
    let pid = u32::try_from(value.get("pid")?.as_u64()?).ok()?;
    let text = |key: &str| value.get(key).and_then(|v| v.as_str()).map(str::to_owned);
    Some(LockHolder {
        pid,
        app: text("app").unwrap_or_default(),
        at: text("at"),
    })
}

fn modified_at(file: &Path) -> SystemTime {
    fs::metadata(file)
        .and_then(|m| m.modified())
        .unwrap_or(UNIX_EPOCH)
}

fn epoch_ms(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// A holder that is gone, or that wrote its lock before this boot (its pid may be reused). An unreadable lock is
/// stale once it is older than the write grace.
fn stale(file: &Path, holder: Option<&LockHolder>, now: SystemTime) -> bool {
    let Some(holder) = holder else {
        return now
            .duration_since(modified_at(file))
            .is_ok_and(|age| age > UNWRITTEN_GRACE);
    };
    if let (Some(uptime), Some(at)) = (uptime(), holder.at.as_deref().and_then(parse_iso_ms)) {
        let booted_at = epoch_ms(now).saturating_sub(epoch_ms(UNIX_EPOCH + uptime));
        if at < booted_at {
            return true;
        }
    }
    holder.pid != std::process::id() && !alive(holder.pid)
}

fn unwritten(file: &Path) -> LockHolder {
    LockHolder {
        pid: 0,
        app: "Another WeaveForge".into(),
        at: Some(iso_utc(modified_at(file))),
    }
}

/// Removes a stale lock without racing another process doing the same. Deleting by path could delete a fresh lock
/// that replaced the stale one after it was read, so whatever is there is moved aside under a name only this process
/// uses, checked again, and put back when it is not stale after all.
fn take_over_stale(dir: &Path, file: &Path, now: SystemTime) -> Result<(), LockError> {
    let mut aside = OsString::from(file.as_os_str());
    aside.push(format!(
        ".{}.{}.stale",
        std::process::id(),
        epoch_ms(SystemTime::now())
    ));
    let aside = PathBuf::from(aside);
    match fs::rename(file, &aside) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    }
    let moved = read_holder(&aside);
    if moved.as_ref().is_some_and(|h| h.pid == std::process::id())
        || stale(&aside, moved.as_ref(), now)
    {
        let _ = fs::remove_file(&aside);
        return Ok(());
    }
    // Someone's live lock was moved: restore it unless yet another one is there. Either way this take is refused.
    let _ = fs::hard_link(&aside, file);
    let holder = moved.unwrap_or_else(|| unwritten(&aside));
    let _ = fs::remove_file(&aside);
    Err(LockError::InUse {
        dir: dir.to_path_buf(),
        holder,
    })
}

/// Time since boot; `None` where it is not known.
#[cfg(windows)]
fn uptime() -> Option<Duration> {
    // SAFETY: GetTickCount64 takes no arguments and only reads a system counter.
    #[allow(unsafe_code)]
    let ms = unsafe { windows::Win32::System::SystemInformation::GetTickCount64() };
    Some(Duration::from_millis(ms))
}

/// Time since boot; `None` where it is not known.
#[cfg(not(windows))]
fn uptime() -> Option<Duration> {
    let text = fs::read_to_string("/proc/uptime").ok()?;
    let secs: f64 = text.split_whitespace().next()?.parse().ok()?;
    Duration::try_from_secs_f64(secs).ok()
}

/// Whether `pid` is a running process, as Node's `process.kill(pid, 0)` answers it: one owned by someone else counts.
#[cfg(windows)]
fn alive(pid: u32) -> bool {
    use windows::Win32::Foundation::{CloseHandle, ERROR_ACCESS_DENIED};
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    const STILL_ACTIVE: u32 = 259;
    // SAFETY: OpenProcess takes plain values and returns an owned handle or an error.
    #[allow(unsafe_code)]
    let handle = match unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
        Ok(handle) => handle,
        Err(e) => return e.code() == windows::core::HRESULT::from_win32(ERROR_ACCESS_DENIED.0),
    };
    let mut code = 0u32;
    // SAFETY: `handle` is a valid process handle opened above, and `code` outlives the call.
    #[allow(unsafe_code)]
    let read = unsafe { GetExitCodeProcess(handle, &raw mut code) };
    // SAFETY: `handle` was opened above and is closed exactly once, here.
    #[allow(unsafe_code)]
    let _ = unsafe { CloseHandle(handle) };
    read.is_err() || code == STILL_ACTIVE
}

/// Whether `pid` is a running process, as Node's `process.kill(pid, 0)` answers it: one owned by someone else counts.
#[cfg(all(unix, not(any(target_os = "android", target_os = "ios"))))]
fn alive(pid: u32) -> bool {
    let Some(pid) = i32::try_from(pid)
        .ok()
        .and_then(rustix::process::Pid::from_raw)
    else {
        // kill(0, 0) signals the caller's own group, so Node calls pid 0 alive.
        return true;
    };
    match rustix::process::test_kill_process(pid) {
        Ok(()) => true,
        Err(e) => e == rustix::io::Errno::PERM,
    }
}

/// Phones never share a data dir with another app: a holder that is not this process counts as alive.
#[cfg(not(any(windows, all(unix, not(any(target_os = "android", target_os = "ios"))))))]
fn alive(_pid: u32) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wf-db-lock-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        dir.join("local-db")
    }

    fn write_lock(dir: &Path, body: &str) {
        let _ = fs::write(lock_path(dir), body);
    }

    #[test]
    fn lock_path_appends_dot_lock() {
        assert_eq!(
            lock_path(Path::new("a/local-db")),
            PathBuf::from("a/local-db.lock")
        );
    }

    #[test]
    fn acquire_writes_holder_and_release_removes_it() {
        let dir = temp("acquire");
        assert!(acquire(&dir, "test-app", SystemTime::now()).is_ok());
        let holder = read_holder(&lock_path(&dir));
        assert_eq!(holder.as_ref().map(|h| h.pid), Some(std::process::id()));
        assert_eq!(holder.map(|h| h.app), Some("test-app".to_owned()));
        // Again from the same process: a no-op.
        assert!(acquire(&dir, "test-app", SystemTime::now()).is_ok());
        release(&dir);
        assert!(!lock_path(&dir).exists());
    }

    #[test]
    fn live_holder_refuses_and_release_keeps_it() {
        let dir = temp("live");
        // A live process that is not this one: the parent of this test binary is not guaranteed, so use pid of a
        // child spawned for the test.
        let child = std::process::Command::new(if cfg!(windows) { "cmd" } else { "sleep" })
            .args(if cfg!(windows) {
                vec!["/c", "ping", "-n", "30", "127.0.0.1"]
            } else {
                vec!["30"]
            })
            .stdout(std::process::Stdio::null())
            .spawn();
        let Ok(mut child) = child else {
            panic!("could not spawn the helper process")
        };
        let body = serde_json::json!({ "pid": child.id(), "app": "Other", "at": iso_utc(SystemTime::now()) });
        write_lock(&dir, &body.to_string());
        let result = acquire(&dir, "test-app", SystemTime::now());
        let _ = child.kill();
        let _ = child.wait();
        match result {
            Err(LockError::InUse { holder, .. }) => assert_eq!(holder.app, "Other"),
            other => panic!("expected InUse, got {other:?}"),
        }
        release(&dir);
        assert!(lock_path(&dir).exists());
    }

    #[test]
    fn dead_holder_is_taken_over() {
        let dir = temp("dead");
        let child = std::process::Command::new(if cfg!(windows) { "cmd" } else { "true" })
            .args(if cfg!(windows) {
                vec!["/c", "exit"]
            } else {
                vec![]
            })
            .spawn();
        let Ok(mut child) = child else {
            panic!("could not spawn the helper process")
        };
        let pid = child.id();
        let _ = child.wait();
        let body =
            serde_json::json!({ "pid": pid, "app": "Gone", "at": iso_utc(SystemTime::now()) });
        write_lock(&dir, &body.to_string());
        assert!(acquire(&dir, "test-app", SystemTime::now()).is_ok());
        assert_eq!(
            read_holder(&lock_path(&dir)).map(|h| h.pid),
            Some(std::process::id())
        );
        release(&dir);
    }

    #[test]
    fn lock_from_before_boot_is_stale() {
        let dir = temp("boot");
        if uptime().is_none() {
            return;
        }
        // pid of this process's parent may be alive; a lock from 1970 predates any boot.
        let body = serde_json::json!({ "pid": 1, "app": "Old", "at": "1970-01-02T00:00:00.000Z" });
        write_lock(&dir, &body.to_string());
        assert!(acquire(&dir, "test-app", SystemTime::now()).is_ok());
        release(&dir);
    }

    #[test]
    fn unreadable_lock_is_fresh_within_grace_then_stale() {
        let dir = temp("unreadable");
        write_lock(&dir, "");
        match acquire(&dir, "test-app", SystemTime::now()) {
            Err(LockError::InUse { holder, .. }) => {
                assert_eq!(holder.pid, 0);
                assert_eq!(holder.app, "Another WeaveForge");
            }
            other => panic!("expected InUse, got {other:?}"),
        }
        assert!(
            acquire(
                &dir,
                "test-app",
                SystemTime::now() + Duration::from_secs(10)
            )
            .is_ok()
        );
        release(&dir);
    }

    #[test]
    fn holder_without_numeric_pid_is_unreadable() {
        let dir = temp("nopid");
        write_lock(&dir, r#"{"pid":"12","app":"x"}"#);
        assert_eq!(read_holder(&lock_path(&dir)), None);
    }
}
