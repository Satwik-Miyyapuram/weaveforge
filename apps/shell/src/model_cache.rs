//! Encoder weights cache: serves `app://models/...` from disk, downloading each file from Hugging Face on its first ask.
//! Ported from the retired Electron shell.

use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};

use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio::sync::{Notify, watch};

use crate::protocol::{APP_HOSTS, Reply};
use crate::range::serve_file_capped;

/// The host the weights come from, when they are not on disk yet.
pub const UPSTREAM: &str = "https://huggingface.co";
/// The cache's own hostname; a path under it is the file's path under the cache root.
pub const MODEL_HOST: &str = "models";
/// The folder of the app's own origin the renderer asks for weights under.
pub const MODEL_PATH: &str = "/models/";
/// A model file is tens of megabytes; anything far past that is not one.
pub const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
/// Redirects one download may follow.
pub const MAX_HOPS: usize = 10;

/// The models folder holds a few models; past this a download is refused rather than fill the disk.
pub const MAX_FOLDER_BYTES: u64 = 4 * 1024 * 1024 * 1024;

const BAD_GATEWAY: u16 = 502;
/// The reader stopped the download; the part stays to resume from.
pub const STOPPED: u16 = 499;
/// The models folder is at its cap.
pub const FOLDER_FULL: u16 = 507;

type Downloads = HashMap<PathBuf, watch::Receiver<Option<u16>>>;

/// Downloads in flight, by the file they will land in. Joiners wait on the leader's status.
static DOWNLOADS: LazyLock<Mutex<Downloads>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static PART_SEQ: AtomicU64 = AtomicU64::new(0);

/// A download in flight, as Settings shows it, with the switch that stops it.
struct Active {
    done: u64,
    total: Option<u64>,
    stop: Arc<Notify>,
}

/// Downloads writing bytes now, by the file they will land in.
static ACTIVE: LazyLock<Mutex<HashMap<PathBuf, Active>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn active() -> MutexGuard<'static, HashMap<PathBuf, Active>> {
    ACTIVE.lock().unwrap_or_else(PoisonError::into_inner)
}

/// One download's progress, as the page reads it. Sizes are bytes.
#[derive(Debug, Clone, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownload {
    /// The file's name, such as `model.onnx`.
    pub file: String,
    /// Bytes on disk so far, counting a resumed part.
    pub done: f64,
    /// The file's full size, when the upstream said.
    pub total: Option<f64>,
}

/// The downloads in flight now.
#[must_use]
pub fn model_downloads() -> Vec<ModelDownload> {
    let mut list: Vec<ModelDownload> = active()
        .iter()
        .map(|(file, a)| ModelDownload {
            file: file
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            #[expect(clippy::cast_precision_loss, reason = "sizes stay far below 2^53")]
            done: a.done as f64,
            #[expect(clippy::cast_precision_loss, reason = "sizes stay far below 2^53")]
            total: a.total.map(|n| n as f64),
        })
        .collect();
    list.sort_by(|a, b| a.file.cmp(&b.file));
    list
}

/// Stops every download under `root`; each keeps its part to resume from.
pub fn cancel_downloads_under(root: &Path) {
    let map = active();
    let stops: Vec<_> = map
        .iter()
        .filter(|(file, _)| file.starts_with(root))
        .map(|(_, a)| Arc::clone(&a.stop))
        .collect();
    for stop in &stops {
        stop.notify_one();
    }
}

/// Registers a download in `ACTIVE`; dropping it takes the entry out again.
struct Tracked {
    file: PathBuf,
    stop: Arc<Notify>,
}

impl Tracked {
    fn start(file: &Path) -> Self {
        let stop = Arc::new(Notify::new());
        let entry = Active {
            done: 0,
            total: None,
            stop: Arc::clone(&stop),
        };
        let _ = active().insert(file.to_path_buf(), entry);
        Self {
            file: file.to_path_buf(),
            stop,
        }
    }

    fn update(&self, done: u64, total: Option<u64>) {
        if let Some(entry) = active().get_mut(&self.file) {
            entry.done = done;
            entry.total = total;
        }
    }
}

impl Drop for Tracked {
    fn drop(&mut self) {
        let _ = active().remove(&self.file);
    }
}

/// How big a download may grow, alone and with the rest of the models folder.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Bytes one file may have.
    pub file: u64,
    /// Bytes the whole models folder may hold once the file is in.
    pub folder: u64,
}

/// Whether a redirect target is still Hugging Face's own infrastructure (the LFS CDN is a per-region `hf.co` subdomain).
#[must_use]
pub fn is_upstream_host(hostname: &str) -> bool {
    let host = hostname.to_ascii_lowercase();
    host == "huggingface.co"
        || host.ends_with(".huggingface.co")
        || host == "hf.co"
        || host.ends_with(".hf.co")
}

/// The path under the cache for a request path, or `None` when it is not a models request.
#[must_use]
pub fn model_path(host: &str, path: &str) -> Option<String> {
    if host == MODEL_HOST {
        return Some(path.to_owned());
    }
    if !APP_HOSTS.contains(&host) {
        return None;
    }
    path.strip_prefix(MODEL_PATH).map(|rest| format!("/{rest}"))
}

/// The file under `root` a cache path names, or `None` if it would leave `root`.
#[must_use]
pub fn cache_path_for(root: &Path, path: &str) -> Option<PathBuf> {
    let decoded = percent_decode(path)?;
    let parts: Vec<&str> = decoded.split('/').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() || !parts.iter().all(|p| is_cache_part(p)) {
        return None;
    }
    let mut file = root.to_path_buf();
    for part in parts {
        file.push(part);
    }
    // A drive prefix in a part replaces the whole path; that lands outside `root`.
    file.starts_with(root).then_some(file)
}

/// Windows device names: a file part named one of these (with any extension) opens the device.
const DEVICE_NAMES: [&str; 4] = ["CON", "PRN", "AUX", "NUL"];

/// One part of a cache path that is safe as a file name on every platform: 1 to 255 of
/// `A-Za-z0-9._-`, not `.` or `..`, no trailing `.`, and not a Windows device name.
#[must_use]
pub fn is_cache_part(part: &str) -> bool {
    let stem = part
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let numbered_device = (stem.starts_with("COM") || stem.starts_with("LPT"))
        && stem.len() == 4
        && stem.bytes().last().is_some_and(|b| b.is_ascii_digit());
    (1..=255).contains(&part.len())
        && !part.ends_with('.')
        && part
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        && !DEVICE_NAMES.contains(&stem.as_str())
        && !numbered_device
}

/// Whether a download may go to `url`: https on Hugging Face's own hosts.
#[must_use]
pub fn is_upstream_url(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some_and(is_upstream_host)
}

/// Gives up connecting to the upstream after this long.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
/// Gives up when the upstream sends nothing for this long.
const READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// A client that follows at most `MAX_HOPS` redirects, and stops at a hop `allow` refuses.
///
/// # Errors
/// When reqwest cannot build the client (TLS backend failed to load).
pub fn model_client(allow: fn(&reqwest::Url) -> bool) -> Result<reqwest::Client, reqwest::Error> {
    crate::tls::with_roots(reqwest::Client::builder())
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() > MAX_HOPS || !allow(attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
}

/// Serves `root`/`path` from disk, or downloads `{upstream}{path}` once, stores it, then serves it.
/// `range` is the request's `Range` header.
pub async fn serve_model_file(
    client: &reqwest::Client,
    root: &Path,
    path: &str,
    upstream: &str,
    range: Option<&str>,
) -> Reply {
    serve_model_file_capped(client, root, path, upstream, range, MAX_FILE_BYTES).await
}

/// `serve_model_file` with the size cap as a parameter, so tests can use a small one.
pub async fn serve_model_file_capped(
    client: &reqwest::Client,
    root: &Path,
    path: &str,
    upstream: &str,
    range: Option<&str>,
    cap: u64,
) -> Reply {
    let limits = Limits {
        file: cap,
        folder: MAX_FOLDER_BYTES,
    };
    serve_model_file_limited(client, root, path, upstream, range, limits).await
}

/// `serve_model_file` with both caps as parameters.
pub async fn serve_model_file_limited(
    client: &reqwest::Client,
    root: &Path,
    path: &str,
    upstream: &str,
    range: Option<&str>,
    limits: Limits,
) -> Reply {
    let Some(file) = cache_path_for(root, path) else {
        return bare(404);
    };
    let ask = Ask {
        client,
        root,
        path,
        upstream,
        limits,
    };
    let range = range.map(str::to_owned);
    let cap = limits.file;
    if let Some(reply) = serve_disk(file.clone(), range.clone(), cap).await {
        return reply;
    }
    match claim(&file) {
        Claim::Lead(leader) => lead_download(&leader, &ask, range).await,
        Claim::Join(rx) => match join(rx, file.clone(), range.clone(), cap).await {
            Some(reply) => reply,
            // The leader left nothing to share: download it ourselves, once.
            None => match claim(&file) {
                Claim::Lead(leader) => lead_download(&leader, &ask, range).await,
                Claim::Join(rx) => join(rx, file, range, cap)
                    .await
                    .unwrap_or_else(|| bare(BAD_GATEWAY)),
            },
        },
    }
}

/// What one download asks for, and where it may store it.
struct Ask<'a> {
    client: &'a reqwest::Client,
    root: &'a Path,
    path: &'a str,
    upstream: &'a str,
    limits: Limits,
}

/// Who serves a file that is not on disk: the first ask downloads it, later asks wait for that download.
enum Claim {
    Lead(Leader),
    Join(watch::Receiver<Option<u16>>),
}

/// Holds a file's slot in `DOWNLOADS`; dropping it frees the slot, even when the download was cancelled.
struct Leader {
    file: PathBuf,
    status: watch::Sender<Option<u16>>,
}

impl Drop for Leader {
    fn drop(&mut self) {
        let _ = downloads().remove(&self.file);
    }
}

fn downloads() -> MutexGuard<'static, Downloads> {
    DOWNLOADS.lock().unwrap_or_else(PoisonError::into_inner)
}

fn claim(file: &Path) -> Claim {
    let mut map = downloads();
    if let Some(rx) = map.get(file) {
        return Claim::Join(rx.clone());
    }
    let (status, rx) = watch::channel(None);
    let _ = map.insert(file.to_path_buf(), rx);
    Claim::Lead(Leader {
        file: file.to_path_buf(),
        status,
    })
}

/// The leader's download, unless the file landed on disk while this ask was claiming it.
async fn lead_download(leader: &Leader, ask: &Ask<'_>, range: Option<String>) -> Reply {
    let cap = ask.limits.file;
    let reply = match serve_disk(leader.file.clone(), range.clone(), cap).await {
        Some(reply) => reply,
        None => match download(ask, &leader.file).await {
            Ok(Stored::At(file)) => serve_disk(file, range, cap)
                .await
                .unwrap_or_else(|| bare(BAD_GATEWAY)),
            // The rename did not land: serve the part's bytes once, then drop them.
            Ok(Stored::Stray(part)) => {
                let reply = serve_disk(part.clone(), range, cap)
                    .await
                    .unwrap_or_else(|| bare(BAD_GATEWAY));
                let _ = std::fs::remove_file(&part);
                reply
            }
            Err(status) => bare(status),
        },
    };
    let _ = leader.status.send_replace(Some(reply.status));
    reply
}

/// A joiner's answer: the file from disk once the leader stored it, or the
/// upstream's own refusal (such as 404). `None` when the leader left nothing to
/// share: it was cancelled, could not store the file, or got no answer upstream.
async fn join(
    mut rx: watch::Receiver<Option<u16>>,
    file: PathBuf,
    range: Option<String>,
    cap: u64,
) -> Option<Reply> {
    let state = match rx.wait_for(Option::is_some).await {
        Ok(state) => *state,
        Err(_) => None,
    };
    match state {
        Some(status) if (200..300).contains(&status) => serve_disk(file, range, cap).await,
        Some(status) if status != BAD_GATEWAY => Some(bare(status)),
        _ => None,
    }
}

/// The file from disk, or `None` when it is not there to read. Read whole up to `cap`, as the download was.
async fn serve_disk(file: PathBuf, range: Option<String>, cap: u64) -> Option<Reply> {
    tokio::task::spawn_blocking(move || {
        match serve_file_capped(&file, range.as_deref(), headers_for(&file), cap) {
            Ok(reply) => Some(reply),
            Err(error) if error.kind() == ErrorKind::FileTooLarge => Some(bare(500)),
            Err(_) => None,
        }
    })
    .await
    .ok()
    .flatten()
}

/// Where a finished download's bytes are.
enum Stored {
    /// In place, under the file's own name.
    At(PathBuf),
    /// Still in the part file, because the rename failed.
    Stray(PathBuf),
}

/// The part file a download writes into.
struct Part {
    path: PathBuf,
    file: tokio::fs::File,
    /// Bytes already in it from an earlier, stopped download.
    len: u64,
}

/// Opens `{file}.part`, locked so a second app filling the same cache cannot write it too.
/// When another process holds it, a part name only this download uses, with nothing to resume.
fn open_part(file: &Path) -> Option<Part> {
    std::fs::create_dir_all(file.parent()?).ok()?;
    let mut stable = file.as_os_str().to_owned();
    stable.push(".part");
    let stable = PathBuf::from(stable);
    let opened = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&stable);
    if let Ok(handle) = opened
        && handle.try_lock().is_ok()
    {
        let len = handle.metadata().map(|m| m.len()).unwrap_or(0);
        let file = tokio::fs::File::from_std(handle);
        return Some(Part {
            path: stable,
            file,
            len,
        });
    }
    let path = part_path(file);
    let handle = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .ok()?;
    let file = tokio::fs::File::from_std(handle);
    Some(Part { path, file, len: 0 })
}

/// A name only this download uses, so two processes filling one cache do not clash.
fn part_path(file: &Path) -> PathBuf {
    let seq = PART_SEQ.fetch_add(1, Ordering::Relaxed);
    let mut name = file.as_os_str().to_owned();
    name.push(format!(".{}.{seq}.part", std::process::id()));
    PathBuf::from(name)
}

/// How a download ended without a file: the status to answer with, and whether
/// the part is worth keeping to resume from (a stop or a dropped connection).
struct Failed {
    status: u16,
    keep: bool,
}

const fn drop_part(status: u16) -> Failed {
    Failed {
        status,
        keep: false,
    }
}

const fn keep_part(status: u16) -> Failed {
    Failed { status, keep: true }
}

/// Downloads the ask into `file` through its part, resuming a part an earlier try left.
/// An error is the status to answer with.
async fn download(ask: &Ask<'_>, file: &Path) -> Result<Stored, u16> {
    let owned = file.to_path_buf();
    let Some(mut part) = tokio::task::spawn_blocking(move || open_part(&owned))
        .await
        .ok()
        .flatten()
    else {
        return Err(BAD_GATEWAY);
    };
    let tracked = Tracked::start(file);
    match fill(ask, &mut part, &tracked).await {
        Ok(()) => Ok(finish(part, file).await),
        Err(failed) => {
            let written = part.file.metadata().await.map(|m| m.len()).unwrap_or(0);
            drop(part.file.into_std().await);
            if !failed.keep || written == 0 {
                let _ = std::fs::remove_file(&part.path);
                prune_empty(&part.path, ask.root);
            }
            Err(failed.status)
        }
    }
}

/// Removes the folders above `file` that are now empty, up to `root`, so a failed download leaves nothing.
fn prune_empty(file: &Path, root: &Path) {
    let mut dir = file.parent();
    while let Some(d) = dir.filter(|d| d.starts_with(root) && *d != root) {
        // `remove_dir` refuses a folder that still holds anything.
        if std::fs::remove_dir(d).is_err() {
            return;
        }
        dir = d.parent();
    }
}

/// Closes the part and renames it into place.
async fn finish(part: Part, file: &Path) -> Stored {
    // Closed first: Windows cannot rename a file that is still open.
    drop(part.file.into_std().await);
    if std::fs::rename(&part.path, file).is_ok() {
        Stored::At(file.to_path_buf())
    } else {
        Stored::Stray(part.path)
    }
}

/// Asks the upstream from where the part stops, and writes the answer into the part.
async fn fill(ask: &Ask<'_>, part: &mut Part, tracked: &Tracked) -> Result<(), Failed> {
    let mut request = ask.client.get(format!("{}{}", ask.upstream, ask.path));
    if part.len > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={}-", part.len));
    }
    let mut response = tokio::select! {
        sent = request.send() => sent.map_err(|_| keep_part(BAD_GATEWAY))?,
        () = tracked.stop.notified() => return Err(keep_part(STOPPED)),
    };
    let offset = start_offset(&response, part.len)?;
    if offset == 0 && part.len > 0 {
        part.file
            .set_len(0)
            .await
            .map_err(|_| drop_part(BAD_GATEWAY))?;
    }
    let _ = part
        .file
        .seek(std::io::SeekFrom::Start(offset))
        .await
        .map_err(|_| drop_part(BAD_GATEWAY))?;
    let total = response.content_length().map(|n| n.saturating_add(offset));
    let used = folder_bytes(ask.root).await.saturating_sub(offset);
    within(ask, total.unwrap_or(offset), used)?;
    let mut done = offset;
    tracked.update(done, total);
    loop {
        let chunk = tokio::select! {
            chunk = response.chunk() => chunk.map_err(|_| keep_part(BAD_GATEWAY))?,
            () = tracked.stop.notified() => return Err(keep_part(STOPPED)),
        };
        let Some(chunk) = chunk else { break };
        done = done.saturating_add(u64::try_from(chunk.len()).unwrap_or(u64::MAX));
        within(ask, done, used)?;
        part.file
            .write_all(&chunk)
            .await
            .map_err(|_| drop_part(BAD_GATEWAY))?;
        tracked.update(done, total);
    }
    part.file.flush().await.map_err(|_| drop_part(BAD_GATEWAY))
}

/// Refuses a file of `size` bytes that is over the file cap, or that the models folder,
/// already holding `used` bytes, has no room for.
fn within(ask: &Ask<'_>, size: u64, used: u64) -> Result<(), Failed> {
    if size > ask.limits.file {
        return Err(drop_part(BAD_GATEWAY));
    }
    if used.saturating_add(size) > ask.limits.folder {
        return Err(drop_part(FOLDER_FULL));
    }
    Ok(())
}

/// Where the body starts in the file: 0 for a whole answer, `had` for a resumed one.
fn start_offset(response: &reqwest::Response, had: u64) -> Result<u64, Failed> {
    let status = response.status();
    // A redirect the policy refused carries no Location the page could use.
    if status.is_redirection() {
        return Err(drop_part(BAD_GATEWAY));
    }
    if status.as_u16() == 206 {
        let prefix = format!("bytes {had}-");
        let resumes = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with(&prefix));
        return if resumes {
            Ok(had)
        } else {
            Err(drop_part(BAD_GATEWAY))
        };
    }
    if !status.is_success() {
        // 416: the part no longer matches the file upstream; start over next time.
        let status = if status.as_u16() == 416 {
            BAD_GATEWAY
        } else {
            status.as_u16()
        };
        return Err(drop_part(status));
    }
    Ok(0)
}

/// Bytes in the models folder now.
async fn folder_bytes(root: &Path) -> u64 {
    let root = root.to_path_buf();
    tokio::task::spawn_blocking(move || crate::app_storage::dir_usage(&root).bytes)
        .await
        .unwrap_or(0)
}

/// The content type, and nothing else: no CORS header, the renderer reads these same-origin.
fn headers_for(file: &Path) -> Vec<(&'static str, String)> {
    let name = file.to_string_lossy();
    let content_type = if name.ends_with(".json") {
        "application/json"
    } else if name.ends_with(".onnx") {
        "application/octet-stream"
    } else {
        "text/plain; charset=utf-8"
    };
    vec![("content-type", content_type.to_owned())]
}

/// A reply with a status and no headers or body.
fn bare(status: u16) -> Reply {
    Reply {
        status,
        headers: Vec::new(),
        body: Vec::new(),
    }
}

/// Decodes `%XX` escapes as `decodeURIComponent` does; `None` on a bad escape or non-UTF-8.
fn percent_decode(text: &str) -> Option<String> {
    let mut out = Vec::with_capacity(text.len());
    let mut bytes = text.bytes();
    while let Some(b) = bytes.next() {
        if b == b'%' {
            let hi = char::from(bytes.next()?).to_digit(16)?;
            let lo = char::from(bytes.next()?).to_digit(16)?;
            out.push(u8::try_from(hi * 16 + lo).ok()?);
        } else {
            out.push(b);
        }
    }
    String::from_utf8(out).ok()
}
