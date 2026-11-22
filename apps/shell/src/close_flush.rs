//! Closing the window, quitting from the menu or installing an update first lets the page
//! save. The editors write their last debounced edit on `pagehide` (note body, ink, canvas,
//! workspace settings), but a window torn down by the shell, or `exit(0)`, fires no
//! `pagehide`. So the shell runs the page's flush (`__wfFlushForClose`, in
//! `apps/web/src/lib/desktop/close-flush.ts`): it fires `pagehide` and resolves once no editor
//! has a write on its way. The page then emits [`FLUSHED`] and the shell closes or exits. A
//! fixed grace either cut a slow write short or kept every close waiting.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use tauri::{Listener as _, Manager as _, Runtime};

/// The page's answer: its last writes have landed (or its own cap ran out).
const FLUSHED: &str = "wf://close-flushed";

/// Longest the shell waits for that answer; a little over the page's own 3 s cap.
const CAP: Duration = Duration::from_millis(3500);

/// The only window with editors; the others hold no unsaved work.
const MAIN: &str = "main";

/// Runs the page's flush, falling back to its close hooks, and answers either way.
const FLUSH_SCRIPT: &str = "Promise.resolve(typeof __wfFlushForClose==='function'?__wfFlushForClose():dispatchEvent(new Event('pagehide'))).catch(()=>{}).then(()=>__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'wf://close-flushed',payload:null}))";

/// Holds the first close of a window for the flush; a second close request goes through.
#[derive(Default)]
struct CloseGate(AtomicBool);

impl CloseGate {
    /// `true` the first time: hold this close and flush. Afterwards `false`: let it close.
    fn hold(&self) -> bool {
        !self.0.swap(true, Ordering::SeqCst)
    }
}

/// Holds the window's close until the page has saved, at most [`CAP`].
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

/// Asks the page to save, then runs `done` once it has (off the event loop).
pub fn flush_then<R: Runtime>(app: &tauri::AppHandle<R>, done: impl FnOnce() + Send + 'static) {
    let app = app.clone();
    let _detached = std::thread::spawn(move || {
        flush_and_wait(&app);
        done();
    });
}

/// Asks the page to save and blocks until it answers, at most [`CAP`]. Returns at once when
/// there is no main window or the script cannot run.
pub fn flush_and_wait<R: Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    let (flushed, answer) = mpsc::channel::<()>();
    let listening = app.listen_any(FLUSHED, move |_| {
        let _ = flushed.send(());
    });
    if window.eval(FLUSH_SCRIPT).is_ok() {
        let _ = answer.recv_timeout(CAP);
    }
    app.unlisten(listening);
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

    #[test]
    fn the_script_answers_with_the_event_the_shell_waits_for() {
        assert!(FLUSH_SCRIPT.contains(&format!("event:'{FLUSHED}'")));
        assert!(
            !FLUSH_SCRIPT.contains('"'),
            "the page test reads the script between quotes"
        );
    }
}
