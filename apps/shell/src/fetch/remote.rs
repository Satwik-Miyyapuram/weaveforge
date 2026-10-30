//! Page titles and images fetched for a pasted link, and their commands.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

use crate::commands::ShellError;

use super::paste::{
    IMAGE_ACCEPT, IMAGE_BYTES, TITLE_ACCEPT, TITLE_BYTES, image_content_type, title_from_page,
};
use super::safe::{FetchOptions, Network, PublicNetwork, safe_fetch_via};
use super::url_shape::{DEFAULT_FETCH_LIMITS, FetchLimits};

/// A page title and the final URL it was read from.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TitleReply {
    /// The page's `<title>`.
    pub title: String,
    /// The final URL after redirects.
    pub url: String,
}

/// An image's bytes, its media type and the final URL it was read from.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImageReply {
    /// The body as standard base64 with padding.
    pub bytes: String,
    /// The lowercase media type.
    pub content_type: String,
    /// The final URL after redirects.
    pub url: String,
}

/// Reads a pasted link's page title through `net`; the error is the sentence to show.
pub async fn fetch_title_via<N: Network>(net: &N, url: &str) -> Result<TitleReply, String> {
    let options = FetchOptions {
        accept: TITLE_ACCEPT.to_owned(),
        limits: FetchLimits {
            max_bytes: TITLE_BYTES,
            ..DEFAULT_FETCH_LIMITS
        },
    };
    let fetched = safe_fetch_via(net, url, &options)
        .await
        .map_err(|failure| failure.message)?;
    let title = title_from_page(&fetched.content_type, &fetched.body)
        .map_err(|refusal| refusal.message.to_owned())?;
    Ok(TitleReply {
        title,
        url: fetched.url,
    })
}

/// Reads a pasted link's image through `net`; the error is the sentence to show.
pub async fn fetch_image_via<N: Network>(net: &N, url: &str) -> Result<ImageReply, String> {
    let options = FetchOptions {
        accept: IMAGE_ACCEPT.to_owned(),
        limits: FetchLimits {
            max_bytes: IMAGE_BYTES,
            ..DEFAULT_FETCH_LIMITS
        },
    };
    let fetched = safe_fetch_via(net, url, &options)
        .await
        .map_err(|failure| failure.message)?;
    let content_type =
        image_content_type(&fetched.content_type).map_err(|refusal| refusal.message.to_owned())?;
    Ok(ImageReply {
        bytes: STANDARD.encode(&fetched.body),
        content_type,
        url: fetched.url,
    })
}

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
