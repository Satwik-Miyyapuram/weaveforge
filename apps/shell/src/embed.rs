//! Text embedding for the page: loads a cached model once, keeps it while used, and drops it when idle.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use tauri::{Emitter as _, Manager as _};
use wf_store::embed::{EmbedKind, Encoder, MODEL_FILES, profile_for};

use crate::app_route::AppRoutes;
use crate::commands::ShellError;
use crate::model_cache::{UPSTREAM, is_cache_part, serve_model_file};

/// The encoder is dropped after this long without an embed.
pub const IDLE_EVICT: Duration = Duration::from_secs(5 * 60);
/// The event that reports model file downloads to the page.
pub const PROGRESS_EVENT: &str = "embedProgress";
/// How often the idle watcher checks the slot.
const WATCH_EVERY: Duration = Duration::from_secs(60);

/// Said when no model is loaded to embed with.
pub const NOT_LOADED: &str = "The model is not loaded.";
/// Said when the model name is not `owner/name` of safe parts.
pub const BAD_MODEL: &str = "That model name cannot be used.";
/// Said when a model file could not be downloaded.
pub const DOWNLOAD_FAILED: &str = "The model files could not be downloaded.";
/// Said when a model file is missing and no client can fetch it.
pub const NO_CLIENT: &str = "Models cannot be downloaded in this build.";
/// Said when the blocking task that embeds or loads the model panicked.
const TASK_FAILED: &str = "The model task did not finish.";
/// Said when the model's vector size does not fit the page's number type.
const TOO_LARGE: &str = "The model's vector size is too large.";

/// Which side of a retrieval pair the texts are on.
#[derive(serde::Deserialize, specta::Type, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EmbedKindArg {
    /// A document passage.
    Passage,
    /// A search query.
    Query,
}

impl From<EmbedKindArg> for EmbedKind {
    fn from(kind: EmbedKindArg) -> Self {
        match kind {
            EmbedKindArg::Passage => EmbedKind::Passage,
            EmbedKindArg::Query => EmbedKind::Query,
        }
    }
}

/// What the page learns about a loaded model.
#[derive(serde::Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmbedInfo {
    /// The length of each vector.
    pub dimensions: u32,
}

/// One model file step of a load, sent as `PROGRESS_EVENT`.
#[derive(serde::Serialize, Clone)]
pub struct EmbedProgress {
    /// Files done so far.
    pub loaded: u32,
    /// Files in the model.
    pub total: u32,
}

/// The cache folder of `model` (`owner/name`) under `models`, or `None` when the name is not safe.
#[must_use]
pub fn model_dir(models: &Path, model: &str) -> Option<PathBuf> {
    let (owner, name) = model.split_once('/')?;
    if !is_cache_part(owner) || !is_cache_part(name) {
        return None;
    }
    Some(models.join(owner).join(name).join("resolve").join("main"))
}

/// The route path of one model file, as `serve_model_file` expects it.
#[must_use]
pub fn file_path(model: &str, file: &str) -> String {
    format!("/{model}/resolve/main/{file}")
}

/// Whether a model unused since `last_used` has been idle for at least `idle` at `now`.
#[must_use]
pub fn is_idle(last_used: Instant, now: Instant, idle: Duration) -> bool {
    now.saturating_duration_since(last_used) >= idle
}

/// The loaded model and when it was last used.
struct Loaded {
    model: String,
    encoder: Encoder,
    last_used: Instant,
}

/// The one loaded encoder, shared by the commands and the idle watcher.
#[derive(Clone, Default)]
pub struct EmbedSlot(Arc<Mutex<Option<Loaded>>>);

impl EmbedSlot {
    /// The slot's lock; a poisoned lock still holds a usable encoder.
    fn lock(&self) -> MutexGuard<'_, Option<Loaded>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Refreshes `last_used` when `model` is loaded and returns its dimensions.
    fn touch(&self, model: &str) -> Option<usize> {
        let mut slot = self.lock();
        let loaded = slot.as_mut().filter(|loaded| loaded.model == model)?;
        loaded.last_used = Instant::now();
        Some(loaded.encoder.dimensions())
    }

    /// Replaces the loaded model with `encoder`, used now.
    fn store(&self, model: String, encoder: Encoder) {
        *self.lock() = Some(Loaded {
            model,
            encoder,
            last_used: Instant::now(),
        });
    }

    /// Drops the encoder when it has been idle, or when nothing is loaded.
    ///
    /// Returns `true` when the watcher can stop: the encoder was dropped or the slot is empty.
    #[must_use]
    pub fn evict_if_idle(&self, now: Instant, idle: Duration) -> bool {
        let mut slot = self.lock();
        let evict = match slot.as_ref() {
            None => true,
            Some(loaded) => is_idle(loaded.last_used, now, idle),
        };
        if evict {
            *slot = None;
        }
        evict
    }

    /// Embeds `texts` with the loaded model.
    ///
    /// # Errors
    /// `NOT_LOADED` when no model is loaded, or the encoder's own message.
    fn embed(&self, texts: &[String], kind: EmbedKind) -> Result<Vec<Vec<f32>>, String> {
        let mut slot = self.lock();
        let loaded = slot.as_mut().ok_or_else(|| NOT_LOADED.to_owned())?;
        let vectors = loaded
            .encoder
            .embed(texts, kind)
            .map_err(|e| e.to_string())?;
        loaded.last_used = Instant::now();
        Ok(vectors)
    }
}

/// Turns a vector length into the page's number type.
fn info(dimensions: usize) -> Result<EmbedInfo, ShellError> {
    let dimensions =
        u32::try_from(dimensions).map_err(|_| ShellError::from(TOO_LARGE.to_owned()))?;
    Ok(EmbedInfo { dimensions })
}

/// Downloads each missing model file into `models` and reports progress after each file.
///
/// # Errors
/// `NO_CLIENT` when a file is missing and no client exists, or `DOWNLOAD_FAILED` on a bad reply.
async fn ensure_files(
    app: &tauri::AppHandle,
    client: Option<&reqwest::Client>,
    models: &Path,
    model: &str,
    dir: &Path,
) -> Result<(), ShellError> {
    let total = u32::try_from(MODEL_FILES.len()).unwrap_or(0);
    for (i, &file) in MODEL_FILES.iter().enumerate() {
        if !dir.join(file).is_file() {
            let client = client.ok_or_else(|| ShellError::from(NO_CLIENT.to_owned()))?;
            let path = file_path(model, file);
            let reply = serve_model_file(client, models, &path, UPSTREAM, Some("bytes=0-0")).await;
            if !matches!(reply.status, 200 | 206) {
                return Err(ShellError::from(DOWNLOAD_FAILED.to_owned()));
            }
        }
        let loaded = u32::try_from(i + 1).unwrap_or(0);
        let _ = app.emit(PROGRESS_EVENT, EmbedProgress { loaded, total });
    }
    Ok(())
}

/// Checks the loaded model every `WATCH_EVERY` and stops once it is evicted.
fn watch(slot: EmbedSlot) {
    let _task = tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(WATCH_EVERY).await;
            if slot.evict_if_idle(Instant::now(), IDLE_EVICT) {
                return;
            }
        }
    });
}

/// Loads `model` (`owner/name`) for embedding, downloading its files first when missing.
///
/// # Errors
/// `BAD_MODEL`, `NO_CLIENT`, `DOWNLOAD_FAILED`, a failed encoder open, or a vector size too large.
#[tauri::command]
#[specta::specta]
pub async fn embed_load(
    app: tauri::AppHandle,
    slot: tauri::State<'_, EmbedSlot>,
    model: String,
) -> Result<EmbedInfo, ShellError> {
    let slot = slot.inner().clone();
    if let Some(dimensions) = slot.touch(&model) {
        return info(dimensions);
    }
    let Some((models, client)) = app
        .try_state::<AppRoutes>()
        .map(|routes| (routes.models.clone(), routes.model_client.clone()))
    else {
        return Err(ShellError::from(NO_CLIENT.to_owned()));
    };
    let dir = model_dir(&models, &model).ok_or_else(|| ShellError::from(BAD_MODEL.to_owned()))?;
    ensure_files(&app, client.as_ref(), &models, &model, &dir).await?;
    let profile_model = model.clone();
    let encoder = tauri::async_runtime::spawn_blocking(move || {
        Encoder::open(&dir, profile_for(&profile_model)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| ShellError::from(TASK_FAILED.to_owned()))?
    .map_err(ShellError::from)?;
    let answer = info(encoder.dimensions())?;
    slot.store(model, encoder);
    watch(slot);
    Ok(answer)
}

/// Embeds texts with the loaded model.
///
/// # Errors
/// `NOT_LOADED` when no model is loaded, or the encoder's own message.
#[tauri::command]
#[specta::specta]
pub async fn embed_texts(
    slot: tauri::State<'_, EmbedSlot>,
    texts: Vec<String>,
    kind: EmbedKindArg,
) -> Result<Vec<Vec<f32>>, ShellError> {
    let slot = slot.inner().clone();
    tauri::async_runtime::spawn_blocking(move || slot.embed(&texts, kind.into()))
        .await
        .map_err(|_| ShellError::from(TASK_FAILED.to_owned()))?
        .map_err(ShellError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_dir_accepts_owner_and_name() {
        let models = Path::new("models");
        assert_eq!(
            model_dir(models, "Xenova/all-MiniLM-L6-v2"),
            Some(
                models
                    .join("Xenova")
                    .join("all-MiniLM-L6-v2")
                    .join("resolve")
                    .join("main")
            )
        );
    }

    #[test]
    fn model_dir_rejects_unsafe_names() {
        for model in ["", "one", "a/b/c", "../x", "a/..", "C:/x", "a/CON"] {
            assert_eq!(model_dir(Path::new("models"), model), None, "{model}");
        }
    }

    #[test]
    fn file_path_is_route_path() {
        assert_eq!(
            file_path("Xenova/all-MiniLM-L6-v2", "tokenizer.json"),
            "/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer.json"
        );
    }

    #[test]
    fn is_idle_at_five_minutes() {
        let base = Instant::now();
        assert!(!is_idle(
            base,
            base + Duration::from_secs(4 * 60 + 59),
            IDLE_EVICT
        ));
        assert!(is_idle(
            base,
            base + Duration::from_secs(5 * 60),
            IDLE_EVICT
        ));
    }

    #[test]
    fn evict_on_empty_slot_stops_watch() {
        assert!(EmbedSlot::default().evict_if_idle(Instant::now(), IDLE_EVICT));
    }
}
