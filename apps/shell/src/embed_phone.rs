//! Phones have no native embeddings: ONNX Runtime ships no Android or iOS build
//! (phase 4, step 4.2). The commands stay registered so the handler list is the same
//! on every platform, and each answers `NO_EMBEDDINGS`.

use crate::commands::ShellError;

/// What every embed command answers on a phone.
pub const NO_EMBEDDINGS: &str = "NO_EMBEDDINGS";

/// Nothing to hold on a phone; managed so the setup code is the same everywhere.
#[derive(Default)]
pub struct EmbedSlot(());

/// # Errors
/// Always `NO_EMBEDDINGS`.
#[tauri::command]
#[specta::specta]
pub async fn embed_load(model: String) -> Result<(), ShellError> {
    drop(model);
    Err(ShellError::from(NO_EMBEDDINGS.to_owned()))
}

/// # Errors
/// Always `NO_EMBEDDINGS`.
#[tauri::command]
#[specta::specta]
pub async fn embed_texts(model: String) -> Result<(), ShellError> {
    drop(model);
    Err(ShellError::from(NO_EMBEDDINGS.to_owned()))
}

/// # Errors
/// Always `NO_EMBEDDINGS`.
#[tauri::command]
#[specta::specta]
pub async fn embed_unload(model: String) -> Result<(), ShellError> {
    drop(model);
    Err(ShellError::from(NO_EMBEDDINGS.to_owned()))
}

/// Phones download no models, so there is never one in flight.
///
/// # Errors
/// Never; the `Err` arm is kept for the Tauri wiring.
#[tauri::command]
#[specta::specta]
pub async fn model_downloads() -> Result<Vec<crate::model_cache::ModelDownload>, ShellError> {
    Ok(Vec::new())
}

/// Nothing to stop on a phone.
///
/// # Errors
/// Never; the `Err` arm is kept for the Tauri wiring.
#[tauri::command]
#[specta::specta]
pub async fn cancel_model_downloads() -> Result<(), ShellError> {
    Ok(())
}
