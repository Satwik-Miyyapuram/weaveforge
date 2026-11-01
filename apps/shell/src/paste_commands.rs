//! Tauri commands for pasted links: page titles and images, fetched through `wf-relay`.

use crate::commands::ShellError;
use crate::fetch::remote::{ImageReply, TitleReply, fetch_image_via, fetch_title_via};
use crate::fetch::safe::PublicNetwork;

/// Fetches the page title of a pasted link from the public internet.
///
/// # Errors
/// Returns the sentence to show when the address is refused, unreachable or has no usable title.
#[tauri::command]
#[specta::specta]
pub async fn fetch_title(url: String) -> Result<TitleReply, ShellError> {
    fetch_title_via(&PublicNetwork, &url)
        .await
        .map_err(ShellError::from)
}

/// Fetches the image of a pasted link from the public internet.
///
/// # Errors
/// Returns the sentence to show when the address is refused, unreachable or not a supported image.
#[tauri::command]
#[specta::specta]
pub async fn fetch_image(url: String) -> Result<ImageReply, ShellError> {
    fetch_image_via(&PublicNetwork, &url)
        .await
        .map_err(ShellError::from)
}
