//! Text embedding for the page: loads cached models, keeps each while used, and drops it when idle.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use tauri::{Emitter as _, Manager as _};
use wf_store::embed::{EmbedKind, Encoder, MODEL_FILES, profile_for};

use crate::app_route::AppRoutes;
use crate::commands::ShellError;
use crate::model_cache::{UPSTREAM, is_cache_part, serve_model_file};

/// A model is dropped after this long without an embed.
pub const IDLE_EVICT: Duration = Duration::from_secs(5 * 60);
/// The event that reports model file downloads to the page.
pub const PROGRESS_EVENT: &str = "embedProgress";
/// How often the idle watcher checks the loaded models.
const WATCH_EVERY: Duration = Duration::from_secs(60);

/// Said when the model asked for is not loaded.
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
    /// The model being loaded, so a page loading two can tell them apart.
    pub model: String,
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

/// One loaded model: its value, vector length, and when it was last used.
struct Entry<T> {
    value: Arc<T>,
    dimensions: usize,
    last_used: Instant,
}

/// The loaded models and whether an idle watcher is running for them.
struct Shelf<T> {
    entries: HashMap<String, Entry<T>>,
    watching: bool,
}

/// Loaded models by name, shared by the commands and the idle watcher.
///
/// Generic so the bookkeeping is testable without a real encoder.
pub struct Models<T>(Arc<Mutex<Shelf<T>>>);

impl<T> Clone for Models<T> {
    fn clone(&self) -> Self {
        Self(Arc::clone(&self.0))
    }
}

impl<T> Default for Models<T> {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(Shelf {
            entries: HashMap::new(),
            watching: false,
        })))
    }
}

impl<T> Models<T> {
    /// The shelf's lock; a poisoned lock still holds usable models.
    fn lock(&self) -> MutexGuard<'_, Shelf<T>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Marks `model` used at `now` and returns its dimensions, or `None` when it is not loaded.
    #[must_use]
    pub fn touch(&self, model: &str, now: Instant) -> Option<usize> {
        let mut shelf = self.lock();
        let entry = shelf.entries.get_mut(model)?;
        entry.last_used = now;
        Some(entry.dimensions)
    }

    /// Marks `model` used at `now` and returns its value, or `None` when it is not loaded.
    #[must_use]
    pub fn get(&self, model: &str, now: Instant) -> Option<Arc<T>> {
        let mut shelf = self.lock();
        let entry = shelf.entries.get_mut(model)?;
        entry.last_used = now;
        Some(Arc::clone(&entry.value))
    }

    /// Adds or replaces `model`, used at `now`.
    ///
    /// Returns `true` when no watcher is running, so the caller must start one.
    #[must_use]
    pub fn store(&self, model: String, value: T, dimensions: usize, now: Instant) -> bool {
        let mut shelf = self.lock();
        let _ = shelf.entries.insert(
            model,
            Entry {
                value: Arc::new(value),
                dimensions,
                last_used: now,
            },
        );
        !std::mem::replace(&mut shelf.watching, true)
    }

    /// Drops `model` if it is loaded.
    pub fn remove(&self, model: &str) {
        let _ = self.lock().entries.remove(model);
    }

    /// Drops every model idle for at least `idle` at `now`.
    ///
    /// Returns `true` when none are left, so the watcher stops; the next `store` starts a new one.
    #[must_use]
    pub fn evict_if_idle(&self, now: Instant, idle: Duration) -> bool {
        let mut shelf = self.lock();
        shelf
            .entries
            .retain(|_, entry| !is_idle(entry.last_used, now, idle));
        let empty = shelf.entries.is_empty();
        if empty {
            shelf.watching = false;
        }
        empty
    }
}

/// One async gate per model name, so loading one model never waits on another's download.
#[derive(Clone, Default)]
pub struct LoadGates(Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>);

impl LoadGates {
    /// The gate for `model`, made on first use and shared after that.
    #[must_use]
    pub fn gate(&self, model: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut gates = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        Arc::clone(gates.entry(model.to_owned()).or_default())
    }
}

/// The loaded encoders, plus per-model gates so two loads of a model never open it twice.
#[derive(Clone, Default)]
pub struct EmbedSlot {
    models: Models<Mutex<Encoder>>,
    gates: LoadGates,
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
        let model = model.to_owned();
        let _ = app.emit(
            PROGRESS_EVENT,
            EmbedProgress {
                model,
                loaded,
                total,
            },
        );
    }
    Ok(())
}

/// Checks the loaded models every `WATCH_EVERY` and stops once none are left.
fn watch(models: Models<Mutex<Encoder>>) {
    let _task = tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(WATCH_EVERY).await;
            if models.evict_if_idle(Instant::now(), IDLE_EVICT) {
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
    if let Some(dimensions) = slot.models.touch(&model, Instant::now()) {
        return info(dimensions);
    }
    // One load per model at a time; a second caller for the same model finds it loaded here.
    let gate = slot.gates.gate(&model);
    let _gate = gate.lock().await;
    if let Some(dimensions) = slot.models.touch(&model, Instant::now()) {
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
    let dimensions = encoder.dimensions();
    let answer = info(dimensions)?;
    if slot
        .models
        .store(model, Mutex::new(encoder), dimensions, Instant::now())
    {
        watch(slot.models.clone());
    }
    Ok(answer)
}

/// Embeds texts with `model`, which `embed_load` must have loaded.
///
/// # Errors
/// `NOT_LOADED` when `model` is not loaded (never loaded, or dropped while idle), or the encoder's own message.
#[tauri::command]
#[specta::specta]
pub async fn embed_texts(
    slot: tauri::State<'_, EmbedSlot>,
    model: String,
    texts: Vec<String>,
    kind: EmbedKindArg,
) -> Result<Vec<Vec<f32>>, ShellError> {
    let models = slot.inner().models.clone();
    let encoder = models
        .get(&model, Instant::now())
        .ok_or_else(|| ShellError::from(NOT_LOADED.to_owned()))?;
    // Only this model's encoder is locked, and only on the blocking thread.
    let vectors = tauri::async_runtime::spawn_blocking(move || {
        encoder
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .embed(&texts, kind.into())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| ShellError::from(TASK_FAILED.to_owned()))?
    .map_err(ShellError::from)?;
    // A long batch counts as use until it ends, not only when it started.
    let _ = models.touch(&model, Instant::now());
    Ok(vectors)
}

/// Drops `model` now instead of waiting for it to go idle, after any load of it in flight.
///
/// # Errors
///
/// Never; the `Err` arm is kept for the Tauri wiring.
#[tauri::command]
#[specta::specta]
pub async fn embed_unload(
    slot: tauri::State<'_, EmbedSlot>,
    model: String,
) -> Result<(), ShellError> {
    let gate = slot.gates.gate(&model);
    let _gate = gate.lock().await;
    slot.models.remove(&model);
    Ok(())
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
        assert!(Models::<u8>::default().evict_if_idle(Instant::now(), IDLE_EVICT));
    }

    #[test]
    fn models_are_kept_apart_by_name() {
        let models = Models::default();
        let now = Instant::now();
        let _ = models.store("a/old".to_owned(), 1_u8, 384, now);
        let _ = models.store("a/new".to_owned(), 2_u8, 768, now);

        assert_eq!(models.get("a/old", now).as_deref(), Some(&1));
        assert_eq!(models.get("a/new", now).as_deref(), Some(&2));
        assert_eq!(models.touch("a/old", now), Some(384));
        assert_eq!(models.touch("a/new", now), Some(768));
        assert_eq!(models.get("a/other", now), None);
        assert_eq!(models.touch("a/other", now), None);
    }

    #[test]
    fn only_the_first_store_starts_a_watcher() {
        let models = Models::default();
        let now = Instant::now();
        assert!(models.store("a/one".to_owned(), 1_u8, 2, now));
        assert!(!models.store("a/two".to_owned(), 2_u8, 2, now));
        assert!(!models.store("a/one".to_owned(), 3_u8, 2, now));
        assert_eq!(models.get("a/one", now).as_deref(), Some(&3));
    }

    #[test]
    fn eviction_drops_only_idle_models() {
        let models = Models::default();
        let base = Instant::now();
        let _ = models.store("a/idle".to_owned(), 1_u8, 2, base);
        let _ = models.store("a/busy".to_owned(), 2_u8, 2, base);
        let later = base + IDLE_EVICT;
        let _ = models.touch("a/busy", later);

        assert!(!models.evict_if_idle(later, IDLE_EVICT));
        assert_eq!(models.get("a/idle", later), None);
        assert_eq!(models.get("a/busy", later).as_deref(), Some(&2));
    }

    #[test]
    fn emptied_shelf_stops_the_watcher_and_the_next_store_starts_one() {
        let models = Models::default();
        let base = Instant::now();
        assert!(models.store("a/one".to_owned(), 1_u8, 2, base));
        assert!(models.evict_if_idle(base + IDLE_EVICT, IDLE_EVICT));
        assert_eq!(models.get("a/one", base + IDLE_EVICT), None);
        assert!(models.store("a/one".to_owned(), 1_u8, 2, base + IDLE_EVICT));
    }

    #[test]
    fn a_value_in_use_outlives_its_eviction() {
        let models = Models::default();
        let base = Instant::now();
        let _ = models.store("a/one".to_owned(), 7_u8, 2, base);
        let held = models.get("a/one", base);
        assert!(models.evict_if_idle(base + IDLE_EVICT, IDLE_EVICT));
        assert_eq!(held.as_deref(), Some(&7));
    }

    #[test]
    fn remove_drops_one_model() {
        let models = Models::default();
        let now = Instant::now();
        let _ = models.store("a/one".to_owned(), 1_u8, 2, now);
        let _ = models.store("a/two".to_owned(), 2_u8, 2, now);
        models.remove("a/one");
        models.remove("a/missing");
        assert_eq!(models.get("a/one", now), None);
        assert_eq!(models.get("a/two", now).as_deref(), Some(&2));
    }

    #[test]
    fn a_held_gate_blocks_only_its_own_model() {
        let gates = LoadGates::default();
        let held = gates.gate("a/one");
        let guard = held.try_lock().ok();
        assert!(guard.is_some());
        assert!(gates.gate("a/one").try_lock().is_err());
        assert!(gates.gate("a/two").try_lock().is_ok());
    }

    #[test]
    fn the_same_model_shares_one_gate() {
        let gates = LoadGates::default();
        assert!(Arc::ptr_eq(&gates.gate("a/one"), &gates.gate("a/one")));
        assert!(!Arc::ptr_eq(&gates.gate("a/one"), &gates.gate("a/two")));
    }
}
