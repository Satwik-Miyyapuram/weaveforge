//! Closing the window or quitting from the menu first lets the page save. The editors write
//! their last debounced edit on `pagehide` (note body, ink, canvas, workspace settings), but
//! a window torn down by the shell, or `exit(0)`, fires no `pagehide`. So the shell fires it,
//! waits a short grace for those writes to reach the file commands, then closes or exits.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{Manager as _, Runtime};

/// How long the page gets to hand its last writes to the shell before the window goes.
const GRACE: Duration = Duration::from_millis(500);

/// Runs the page's own close hooks without unloading it.
const FLUSH_SCRIPT: &str = "dispatchEvent(new Event('pagehide'))";

/// Holds the first close of a window for the flush; a second close request goes through.
#[derive(Default)]
struct CloseGate(AtomicBool);

impl CloseGate {
    /// `true` the first time: hold this close and flush. Afterwards `false`: let it close.
    fn hold(&self) -> bool {
        !self.0.swap(true, Ordering::SeqCst)
    }
}

/// Holds the window's close until the page has had [`GRACE`] to save.
pub fn watch<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    let gate = CloseGate::default();
    let watched = window.clone();
    window.on_window_event(move |event| {
        let tauri::WindowEvent::CloseRequested { api, .. } = event else {
            return;
        };
        if !gate.hold() {
            return;
        }
        api.prevent_close();
        let closing = watched.clone();
        flush_then(watched.app_handle(), move || {
            let _ = closing.destroy();
        });
    });
}

/// Asks every page to save, then runs `done` after [`GRACE`] (off the event loop).
pub fn flush_then<R: Runtime>(app: &tauri::AppHandle<R>, done: impl FnOnce() + Send + 'static) {
    for window in app.webview_windows().values() {
        let _ = window.eval(FLUSH_SCRIPT);
    }
    let _detached = std::thread::spawn(move || {
        std::thread::sleep(GRACE);
        done();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_close_is_held_and_a_second_goes_through() {
        let gate = CloseGate::default();
        assert!(gate.hold());
        assert!(!gate.hold());
        assert!(!gate.hold());
    }
}
