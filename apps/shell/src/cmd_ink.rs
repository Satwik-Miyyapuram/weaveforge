//! Handwriting commands for the page: the helper's availability, recognition and pen haptics.

use crate::commands::ShellError;
use crate::ink::{InkHapticsMessage, InkRecogniser, InkRecognitionRequest, InkRecognitionResult};

/// Error text for a page with no ink to read.
pub const NOT_A_PAGE: &str = "That is not a page to recognise.";

/// Whether the helper can start on this machine.
pub async fn available(ink: &InkRecogniser) -> bool {
    ink.available().await
}

/// Recognises a page of ink; refuses a bad page before the helper starts.
///
/// # Errors
/// Returns `NOT_A_PAGE` when there are no lines, a line has no strokes or a coordinate is not
/// finite, and the helper's error text when recognition fails.
pub async fn recognise(
    ink: &InkRecogniser,
    request: InkRecognitionRequest,
) -> Result<InkRecognitionResult, String> {
    if !is_page(&request) {
        return Err(NOT_A_PAGE.to_owned());
    }
    ink.recognise(request).await
}

/// Whether the page has lines, each with strokes of finite coordinates.
fn is_page(request: &InkRecognitionRequest) -> bool {
    !request.lines.is_empty()
        && request.lines.iter().all(|line| {
            !line.strokes.is_empty()
                && line
                    .strokes
                    .iter()
                    .flatten()
                    .all(|coordinate| coordinate.is_finite())
        })
}

/// Whether the helper can give pen haptics on this machine.
pub async fn haptics_available(ink: &InkRecogniser) -> bool {
    ink.haptics_available().await
}

/// Sends a pen message without waiting; does nothing when the helper is not running.
pub fn haptics(ink: &InkRecogniser, message: &InkHapticsMessage) {
    ink.haptics(message);
}

/// Whether the handwriting helper can start.
///
/// # Errors
/// Never: an unavailable helper is reported as `false`.
#[tauri::command]
#[specta::specta]
pub async fn ink_available(ink: tauri::State<'_, InkRecogniser>) -> Result<bool, ShellError> {
    Ok(available(ink.inner()).await)
}

/// Recognises a page of ink.
///
/// # Errors
/// Fails when the page is empty or malformed, or when the helper is missing, stopped or does
/// not answer in time.
#[tauri::command]
#[specta::specta]
pub async fn ink_recognise(
    ink: tauri::State<'_, InkRecogniser>,
    request: InkRecognitionRequest,
) -> Result<InkRecognitionResult, ShellError> {
    recognise(ink.inner(), request)
        .await
        .map_err(ShellError::from)
}

/// Whether the helper can give pen haptics.
///
/// # Errors
/// Never: an unavailable helper is reported as `false`.
#[tauri::command]
#[specta::specta]
pub async fn ink_haptics_available(
    ink: tauri::State<'_, InkRecogniser>,
) -> Result<bool, ShellError> {
    Ok(haptics_available(ink.inner()).await)
}

/// Sends a pen message to the helper for haptic feedback.
///
/// # Errors
/// Never: the message is dropped when the helper is not running.
#[tauri::command]
#[specta::specta]
pub async fn ink_haptics(
    ink: tauri::State<'_, InkRecogniser>,
    message: InkHapticsMessage,
) -> Result<(), ShellError> {
    haptics(ink.inner(), &message);
    Ok(())
}
