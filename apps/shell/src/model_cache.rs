//! Encoder weights cache: serves `app://models/...` from disk, downloading each file from Hugging Face on its first ask.
//! Port of apps/desktop/src/model-cache.ts.

use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};

use tokio::sync::watch;

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

const BAD_GATEWAY: u16 = 502;

type Downloads = HashMap<PathBuf, watch::Receiver<Option<u16>>>;

/// Downloads in flight, by the file they will land in. Joiners wait on the leader's status.
static DOWNLOADS: LazyLock<Mutex<Downloads>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static PART_SEQ: AtomicU64 = AtomicU64::new(0);

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
    reqwest::Client::builder()
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
    let Some(file) = cache_path_for(root, path) else {
        return bare(404);
    };
    let range = range.map(str::to_owned);
    if let Some(reply) = serve_disk(file.clone(), range.clone(), cap).await {
        return reply;
    }
    match claim(&file) {
        Claim::Join(rx) => join(rx, file, range, cap).await,
        Claim::Lead(leader) => lead_download(&leader, client, path, upstream, range, cap).await,
    }
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
async fn lead_download(
    leader: &Leader,
    client: &reqwest::Client,
    path: &str,
    upstream: &str,
    range: Option<String>,
    cap: u64,
) -> Reply {
    let reply = match serve_disk(leader.file.clone(), range, cap).await {
        Some(reply) => reply,
        None => match fetch_and_store(client, &leader.file, path, upstream, cap).await {
            Ok(body) => Reply {
                status: 200,
                headers: headers_for(&leader.file),
                body,
            },
            Err(status) => bare(status),
        },
    };
    let _ = leader.status.send_replace(Some(reply.status));
    reply
}

/// A joiner's answer: the file from disk once the leader succeeded, else the leader's status.
async fn join(
    mut rx: watch::Receiver<Option<u16>>,
    file: PathBuf,
    range: Option<String>,
    cap: u64,
) -> Reply {
    let state = match rx.wait_for(Option::is_some).await {
        Ok(state) => *state,
        Err(_) => None,
    };
    match state {
        Some(status) if (200..300).contains(&status) => serve_disk(file, range, cap)
            .await
            .unwrap_or_else(|| bare(BAD_GATEWAY)),
        Some(status) => bare(status),
        None => bare(BAD_GATEWAY),
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

/// The body of the upstream file, stored under `file` on success; an error is the status to answer with.
async fn fetch_and_store(
    client: &reqwest::Client,
    file: &Path,
    path: &str,
    upstream: &str,
    cap: u64,
) -> Result<Vec<u8>, u16> {
    let mut response = client
        .get(format!("{upstream}{path}"))
        .send()
        .await
        .map_err(|_| BAD_GATEWAY)?;
    // A redirect the policy refused carries no Location the page could use.
    if response.status().is_redirection() {
        return Err(BAD_GATEWAY);
    }
    if !response.status().is_success() {
        return Err(response.status().as_u16());
    }
    // A declared oversize file is refused before any of it is read.
    if response.content_length().is_some_and(|n| n > cap) {
        return Err(BAD_GATEWAY);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| BAD_GATEWAY)? {
        if !fits(body.len().saturating_add(chunk.len()), cap) {
            return Err(BAD_GATEWAY);
        }
        body.extend_from_slice(&chunk);
    }
    let file = file.to_path_buf();
    tokio::task::spawn_blocking(move || store(&file, body))
        .await
        .ok()
        .flatten()
        .ok_or(BAD_GATEWAY)
}

/// Writes `body` under a part name and renames it into place; `None` when the bytes could not be written.
fn store(file: &Path, body: Vec<u8>) -> Option<Vec<u8>> {
    let dir = file.parent()?;
    std::fs::create_dir_all(dir).ok()?;
    let part = part_path(file);
    if std::fs::write(&part, &body).is_err() {
        let _ = std::fs::remove_file(&part);
        return None;
    }
    // A failed rename still serves these bytes; the next ask downloads again.
    if std::fs::rename(&part, file).is_err() {
        let _ = std::fs::remove_file(&part);
    }
    Some(body)
}

/// A name only this download uses, so two processes filling one cache do not clash.
fn part_path(file: &Path) -> PathBuf {
    let seq = PART_SEQ.fetch_add(1, Ordering::Relaxed);
    let mut name = file.as_os_str().to_owned();
    name.push(format!(".{}.{seq}.part", std::process::id()));
    PathBuf::from(name)
}

fn fits(len: usize, cap: u64) -> bool {
    u64::try_from(len).is_ok_and(|n| n <= cap)
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
