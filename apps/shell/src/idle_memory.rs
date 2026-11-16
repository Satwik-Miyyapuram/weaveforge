//! Idle memory: while the main window is minimized, WebView2 is asked to keep less in memory
//! (`MemoryUsageTargetLevel` Low, WebView2 runtime 1.0.1774+). On restore it goes back to
//! Normal. Low lets the renderer and GPU process drop caches and trim their working sets; the
//! page keeps running (sync, timers), unlike `TrySuspend`. Other platforms: no-op.

/// Watches the main window and switches the WebView2 memory target as it is minimized and
/// restored. Each switch is sent once per change, not on every resize event.
#[cfg(windows)]
pub fn watch(window: &tauri::WebviewWindow) {
    use std::sync::atomic::{AtomicBool, Ordering};
    let low_now = AtomicBool::new(false);
    let watched = window.clone();
    window.on_window_event(move |event| {
        // Minimize and restore arrive as resizes on Windows (to and from 0x0).
        if !matches!(event, tauri::WindowEvent::Resized(_)) {
            return;
        }
        let low = watched.is_minimized().unwrap_or(false);
        if low_now.swap(low, Ordering::SeqCst) != low {
            set_target(&watched, low);
        }
    });
}

/// No memory target outside WebView2.
#[cfg(not(windows))]
pub fn watch(_window: &tauri::WebviewWindow) {}

#[cfg(windows)]
fn set_target(window: &tauri::WebviewWindow, low: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        ICoreWebView2_19,
    };
    use windows::core::Interface as _;
    let level = if low {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
    } else {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
    };
    // An older runtime without ICoreWebView2_19 just keeps its normal level.
    let _ = window.with_webview(move |webview| {
        #[allow(unsafe_code)]
        // SAFETY: COM calls on the live controller Tauri hands to this closure on the UI
        // thread; the interfaces are reference-counted and dropped here.
        unsafe {
            if let Ok(core) = webview.controller().CoreWebView2()
                && let Ok(core19) = core.cast::<ICoreWebView2_19>()
            {
                let _ = core19.SetMemoryUsageTargetLevel(level);
            }
        }
    });
}
