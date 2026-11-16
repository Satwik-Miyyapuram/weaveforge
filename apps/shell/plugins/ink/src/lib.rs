//! The Android ink overlay as a Tauri plugin (phase 4, step 4.3a).
//!
//! The work is in Kotlin (`android/`): `InkPlugin.load` puts the WebView inside an
//! `InkGestureView` with the pen surface above it. This crate only registers that class.

use tauri::Runtime;
use tauri::plugin::{Builder, TauriPlugin};

/// The plugin. A no-op on desktops and iOS.
#[must_use]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ink")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            let _handle = _api.register_android_plugin("org.weaveforge.ink", "InkPlugin")?;
            Ok(())
        })
        .build()
}
