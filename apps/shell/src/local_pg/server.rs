//! The private native Postgres server the shell runs as a child: finds the binaries, creates the
//! data dir once, starts on a free loopback port, waits until it answers, and stops it.

use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use process_wrap::tokio::JobObject;
use process_wrap::tokio::{ChildWrapper, CommandWrap, KillOnDrop};

use super::PgError;
use super::wire;

/// The superuser the server is initialised with.
pub const SUPERUSER: &str = "wf";
/// The database `initdb` creates; used directly.
pub const DATABASE: &str = "postgres";

/// Desktop tuning for `postgres -c key=value`, measured at 84 MB RAM.
const TUNING: &[(&str, &str)] = &[
    ("listen_addresses", "127.0.0.1"),
    ("shared_buffers", "16MB"),
    ("max_connections", "10"),
    ("min_wal_size", "32MB"),
    ("max_wal_size", "64MB"),
    ("wal_level", "minimal"),
    ("max_wal_senders", "0"),
    ("io_method", "sync"),
    ("autovacuum_max_workers", "1"),
    ("max_worker_processes", "2"),
    ("max_parallel_workers", "0"),
    ("max_parallel_workers_per_gather", "0"),
    ("max_parallel_maintenance_workers", "0"),
    ("max_logical_replication_workers", "0"),
    ("logging_collector", "off"),
    ("TimeZone", "UTC"),
    ("DateStyle", "ISO, MDY"),
    ("log_min_messages", "warning"),
];

/// How long startup may take; x86 emulation is slow.
const READY_TIMEOUT: Duration = Duration::from_secs(60);
/// How long a stop waits for a clean exit before killing.
const STOP_TIMEOUT: Duration = Duration::from_secs(15);

/// Longest wait for one connection attempt during start.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// A running private Postgres server. Dropping it kills the child.
pub struct PgServer {
    child: Box<dyn ChildWrapper>,
    port: u16,
    password: String,
    data: PathBuf,
    bin: PathBuf,
}

/// The file name of a tool in the Postgres bin dir, with `.exe` on Windows.
#[must_use]
pub fn exe_name(tool: &str) -> String {
    if cfg!(windows) {
        format!("{tool}.exe")
    } else {
        tool.to_owned()
    }
}

/// Finds the bin dir: the override first, then the bundled `resource_dir/postgres/bin`.
pub fn locate_bin(
    override_dir: Option<&Path>,
    resource_dir: Option<&Path>,
) -> Result<PathBuf, PgError> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = override_dir {
        candidates.push(dir.to_path_buf());
    }
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("postgres").join("bin"));
    }
    candidates
        .into_iter()
        .find(|dir| has_bins(dir))
        .ok_or_else(|| PgError::local("Postgres binaries not found"))
}

/// Whether a dir holds both `postgres` and `initdb`.
fn has_bins(dir: &Path) -> bool {
    dir.join(exe_name("postgres")).is_file() && dir.join(exe_name("initdb")).is_file()
}

/// Arguments for `initdb`, with the password read from `pwfile`.
#[must_use]
pub fn initdb_args(data: &Path, pwfile: &Path) -> Vec<OsString> {
    vec![
        "-D".into(),
        data.into(),
        "-U".into(),
        SUPERUSER.into(),
        "--auth=scram-sha-256".into(),
        "--pwfile".into(),
        pwfile.into(),
        "-E".into(),
        "UTF8".into(),
        "--no-locale".into(),
        "--no-instructions".into(),
    ]
}

/// Arguments for `postgres`: data dir, loopback port, and the tuning.
#[must_use]
pub fn postgres_args(data: &Path, port: u16) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec![
        "-D".into(),
        data.into(),
        "-p".into(),
        port.to_string().into(),
    ];
    for (key, value) in TUNING {
        args.push("-c".into());
        args.push(format!("{key}={value}").into());
    }
    args
}

/// A new superuser password: 24 random bytes as 48 lowercase hex chars.
pub fn new_password() -> Result<String, PgError> {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(|e| PgError::local(e.to_string()))?;
    let mut out = String::with_capacity(48);
    for byte in bytes {
        out.push(char::from(HEX[usize::from(byte >> 4)]));
        out.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    Ok(out)
}

/// A free port on loopback, found by binding to port 0 and letting it go.
pub fn free_port() -> Result<u16, PgError> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|e| io(&e))?;
    let port = listener.local_addr().map_err(|e| io(&e))?.port();
    Ok(port)
}

/// Makes the data dir and password file once; returns the password.
pub async fn ensure_initialized(bin: &Path, root: &Path) -> Result<String, PgError> {
    let data = root.join("data");
    if data.join("PG_VERSION").is_file() {
        return read_password(&root.join("password"));
    }
    fs::create_dir_all(root).map_err(|e| io(&e))?;
    if data.exists() {
        // Keep the failed dir for inspection instead of deleting it.
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis());
        fs::rename(&data, root.join(format!("data.failed-{stamp}"))).map_err(|e| io(&e))?;
    }
    let password = new_password()?;
    write_password(&root.join("password"), &password)?;
    run_initdb(bin, &data, &root.join("password")).await?;
    Ok(password)
}

impl PgServer {
    /// The loopback port the server listens on.
    #[must_use]
    pub fn port(&self) -> u16 {
        self.port
    }

    /// The superuser password.
    #[must_use]
    pub fn password(&self) -> &str {
        &self.password
    }

    /// Initialises if needed, starts the server on a free port, and waits until it answers.
    pub async fn start(bin: &Path, root: &Path) -> Result<PgServer, PgError> {
        let password = ensure_initialized(bin, root).await?;
        let port = free_port()?;
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(root.join("postgres.log"))
            .map_err(|e| io(&e))?;
        let data = root.join("data");
        let child = wrapped_command(
            bin.join(exe_name("postgres")),
            postgres_args(&data, port),
            log,
        )
        .spawn()
        .map_err(|e| PgError::local(format!("Postgres did not spawn: {e}")))?;
        let mut server = PgServer {
            child,
            port,
            password,
            data,
            bin: bin.to_path_buf(),
        };
        match server.wait_ready().await {
            Ok(()) => Ok(server),
            Err(err) => {
                let _ = server.child.start_kill();
                let _ = server.child.wait().await;
                Err(err)
            }
        }
    }

    /// Polls until a connection succeeds, the child exits, or `READY_TIMEOUT` passes.
    async fn wait_ready(&mut self) -> Result<(), PgError> {
        let deadline = Instant::now() + READY_TIMEOUT;
        loop {
            if self.child.try_wait().map_err(|e| io(&e))?.is_some() {
                let log = fs::read_to_string(self.data.with_file_name("postgres.log"))
                    .unwrap_or_default();
                return Err(PgError::local(format!(
                    "Postgres exited at start: {}",
                    tail(&log, 500)
                )));
            }
            if let Ok(Ok(conn)) = tokio::time::timeout(CONNECT_TIMEOUT, self.connect()).await {
                let _ = conn.close().await;
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(PgError::local("Postgres did not start within 60 s"));
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }

    /// A new connection to this server as the superuser.
    pub async fn connect(&self) -> Result<super::wire::PgConn, PgError> {
        wire::connect("127.0.0.1", self.port, SUPERUSER, &self.password, DATABASE).await
    }

    /// Stops the server with `pg_ctl`, killing it if it has not exited within `STOP_TIMEOUT`.
    pub async fn stop(mut self) -> Result<(), PgError> {
        let mut cmd = tokio::process::Command::new(self.bin.join(exe_name("pg_ctl")));
        let _ = cmd
            .kill_on_drop(true)
            .arg("stop")
            .arg("-D")
            .arg(&self.data)
            .args(["-m", "fast", "-t", "15"]);
        #[cfg(windows)]
        let _ = cmd.creation_flags(windows::Win32::System::Threading::CREATE_NO_WINDOW.0);
        // A failed or hung pg_ctl is covered by the kill below.
        let _ = tokio::time::timeout(STOP_TIMEOUT, cmd.output()).await;

        let deadline = Instant::now() + STOP_TIMEOUT;
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let _ = self.child.start_kill();
        let _ = self.child.wait().await;
        Ok(())
    }
}

/// Builds the `postgres` command, wrapped so it dies with the shell; stderr goes to `log`.
fn wrapped_command(program: PathBuf, args: Vec<OsString>, log: fs::File) -> CommandWrap {
    let mut wrap = CommandWrap::with_new(program, move |c| {
        let _ = c.args(&args);
        let _ = c.stdin(Stdio::null());
        let _ = c.stdout(Stdio::null());
        let _ = c.stderr(Stdio::from(log));
    });
    let _ = wrap.wrap(KillOnDrop);
    #[cfg(windows)]
    {
        // JobObject overwrites raw creation flags, so CREATE_NO_WINDOW must go through CreationFlags.
        let _ = wrap.wrap(process_wrap::tokio::CreationFlags(
            windows::Win32::System::Threading::CREATE_NO_WINDOW,
        ));
        let _ = wrap.wrap(JobObject);
    }
    wrap
}

/// Runs `initdb` and returns its error with the tail of stderr on failure.
async fn run_initdb(bin: &Path, data: &Path, pwfile: &Path) -> Result<(), PgError> {
    let mut cmd = tokio::process::Command::new(bin.join(exe_name("initdb")));
    let _ = cmd.kill_on_drop(true).args(initdb_args(data, pwfile));
    #[cfg(windows)]
    let _ = cmd.creation_flags(windows::Win32::System::Threading::CREATE_NO_WINDOW.0);
    let out = tokio::time::timeout(READY_TIMEOUT, cmd.output())
        .await
        .map_err(|_| PgError::local("initdb did not finish within 60 s"))?
        .map_err(|e| io(&e))?;
    if out.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    Err(PgError::local(format!(
        "initdb failed: {}",
        tail(&stderr, 500)
    )))
}

/// Reads the password file, trimmed; missing or empty is an error.
fn read_password(path: &Path) -> Result<String, PgError> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(io(&e)),
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(PgError::local("database password file is missing"));
    }
    Ok(trimmed.to_owned())
}

/// Writes the password file, readable by the owner only on unix.
fn write_password(path: &Path, password: &str) -> Result<(), PgError> {
    use std::io::Write as _;
    let mut options = OpenOptions::new();
    let _ = options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        // Owner-only from the moment the file exists.
        use std::os::unix::fs::OpenOptionsExt;
        let _ = options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| io(&e))?;
    file.write_all(password.as_bytes()).map_err(|e| io(&e))?;
    #[cfg(unix)]
    {
        // An old file keeps its mode on open, so tighten it too.
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|e| io(&e))?;
    }
    Ok(())
}

/// The last `max` chars of `text`, cut on a char boundary.
fn tail(text: &str, max: usize) -> &str {
    let count = text.chars().count();
    if count <= max {
        return text;
    }
    match text.char_indices().nth(count - max) {
        Some((index, _)) => text.get(index..).unwrap_or(""),
        None => "",
    }
}

/// An I/O failure as a local `PgError`.
fn io(err: &std::io::Error) -> PgError {
    PgError::local(err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A unique dir under the system temp dir, for one test.
    fn unique_dir(tag: &str) -> Result<PathBuf, std::time::SystemTimeError> {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        Ok(std::env::temp_dir().join(format!("wf-pg-{tag}-{}-{nanos}", std::process::id())))
    }

    /// Creates fake `postgres` and `initdb` files in `dir`.
    fn fake_bins(dir: &Path) -> std::io::Result<()> {
        fs::create_dir_all(dir)?;
        fs::write(dir.join(exe_name("postgres")), b"")?;
        fs::write(dir.join(exe_name("initdb")), b"")
    }

    #[test]
    fn exe_name_has_exe_suffix_only_on_windows() {
        assert_eq!(exe_name("initdb").ends_with(".exe"), cfg!(windows));
    }

    #[test]
    fn initdb_args_have_auth_locale_user_and_paths() {
        let args: Vec<String> = initdb_args(Path::new("/d"), Path::new("/p"))
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert!(args.contains(&"--auth=scram-sha-256".to_owned()));
        assert!(args.contains(&"--no-locale".to_owned()));
        assert!(args.contains(&"/d".to_owned()));
        assert!(args.contains(&"/p".to_owned()));
        assert!(
            args.windows(2)
                .any(|w| matches!(w, [a, b] if a == "-U" && b == "wf"))
        );
    }

    #[test]
    fn postgres_args_have_head_and_tuning_pairs() {
        let args: Vec<String> = postgres_args(Path::new("/d"), 5555)
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let head: Vec<&str> = args.iter().take(4).map(String::as_str).collect();
        assert_eq!(head, ["-D", "/d", "-p", "5555"]);
        assert!(
            args.windows(2)
                .any(|w| matches!(w, [a, b] if a == "-c" && b == "io_method=sync"))
        );
        assert!(args.contains(&"listen_addresses=127.0.0.1".to_owned()));
        assert!(args.iter().skip(4).step_by(2).all(|f| f == "-c"));
        assert!(args.iter().skip(5).step_by(2).all(|v| v.contains('=')));
    }

    #[test]
    fn new_password_is_48_lowercase_hex_and_random() -> Result<(), PgError> {
        let first = new_password()?;
        let second = new_password()?;
        assert_eq!(first.len(), 48);
        assert!(
            first
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        );
        assert_ne!(first, second);
        Ok(())
    }

    #[test]
    fn free_port_is_nonzero() -> Result<(), PgError> {
        assert_ne!(free_port()?, 0);
        Ok(())
    }

    #[test]
    fn locate_bin_prefers_override_then_resource_then_fails()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = unique_dir("locate")?;
        let over = root.join("over");
        let res_bin = root.join("res").join("postgres").join("bin");
        let empty = root.join("empty");
        fs::create_dir_all(&empty)?;
        fake_bins(&over)?;
        fake_bins(&res_bin)?;

        assert_eq!(locate_bin(Some(&over), Some(&root.join("res")))?, over);
        assert_eq!(locate_bin(Some(&empty), Some(&root.join("res")))?, res_bin);
        let missing = locate_bin(Some(&empty), None);

        fs::remove_dir_all(&root)?;
        assert!(missing.is_err());
        Ok(())
    }

    #[tokio::test]
    async fn ensure_initialized_reuses_existing_password() -> Result<(), Box<dyn std::error::Error>>
    {
        let root = unique_dir("init")?;
        fs::create_dir_all(root.join("data"))?;
        fs::write(root.join("data").join("PG_VERSION"), "18\n")?;
        fs::write(root.join("password"), "abc\n")?;

        let got = ensure_initialized(Path::new("/nonexistent"), &root).await;

        fs::remove_dir_all(&root)?;
        assert_eq!(got?, "abc");
        Ok(())
    }
}
