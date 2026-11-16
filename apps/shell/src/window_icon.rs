//! The running app's window icon: the taskbar's light or dark mode, and the icon the page
//! sends (rendered in the theme's colours, with the contrast guard applied on the page).

use base64::{Engine, engine::general_purpose::STANDARD};
use tauri::image::Image;

use crate::commands::ShellError;

/// Returned when the page's icon is not base64 or not a PNG the window can use.
pub const ICON_BAD: &str = "Window icon must be a base64 PNG.";

/// Registry key and value Windows writes for the app-and-taskbar light theme (1 light, 0 dark).
const THEME_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
const THEME_VALUE: &str = "SystemUsesLightTheme";

/// Whether the taskbar uses the light theme. A missing or unreadable value counts as light,
/// as Windows does for the default install.
#[must_use]
pub fn uses_light_theme_from(value: Option<u32>) -> bool {
    value != Some(0)
}

/// Decodes the page's base64 PNG into a window icon.
///
/// # Errors
/// `ICON_BAD` when the text is not base64 or the bytes are not an image.
pub fn decode_icon(base64_png: &str) -> Result<Image<'static>, String> {
    let bytes = STANDARD
        .decode(base64_png)
        .map_err(|_| ICON_BAD.to_owned())?;
    Image::from_bytes(&bytes).map_err(|_| ICON_BAD.to_owned())
}

#[cfg(windows)]
fn registry_value() -> Option<u32> {
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(THEME_KEY)
        .and_then(|key| key.get_value::<u32, _>(THEME_VALUE))
        .ok()
}

#[cfg(not(windows))]
fn registry_value() -> Option<u32> {
    None
}

/// Whether the OS taskbar is in light mode, read from the user's registry.
#[tauri::command]
#[specta::specta]
pub async fn os_uses_light_theme() -> bool {
    uses_light_theme_from(registry_value())
}

/// Sets the window and taskbar icon from the page's base64 PNG.
///
/// # Errors
/// Returns an error when the bytes are not a PNG or the window refuses the icon.
#[tauri::command]
#[specta::specta]
pub async fn window_icon_set(
    window: tauri::WebviewWindow<tauri::Wry>,
    png_base64: String,
) -> Result<(), ShellError> {
    let icon = decode_icon(&png_base64).map_err(ShellError::from)?;
    window
        .set_icon(icon)
        .map_err(|error| ShellError::from(error.to_string()))
}
