//! Idle memory: while the main window is minimized, WebView2 is asked to keep less in memory
//! (`MemoryUsageTargetLevel` Low, WebView2 runtime 1.0.1774+). On restore it goes back to
//! Normal. Low lets the renderer and GPU process drop caches and trim their working sets; the
//! page keeps running (sync, timers), unlike `TrySuspend`. Other platforms: no-op.
//! The same happens once the window has been in the background (unfocused) for
//! [`AWAY_AFTER`]; focus brings it straight back.

use std::time::Duration;

/// How long the window sits unfocused before WebView2 is asked to keep less.
pub const AWAY_AFTER: Duration = Duration::from_secs(300);

/// What decides the memory target. Every method returns the level to send now
/// (`true` = Low), or `None` when it has not changed.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Default)]
struct Idle {
    minimized: bool,
    away: bool,
    /// Bumped on every focus change, so a countdown started by an older blur is void.
    ticket: u64,
    sent_low: bool,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl Idle {
    fn change(&mut self) -> Option<bool> {
        let low = self.minimized || self.away;
        (low != self.sent_low).then(|| {
            self.sent_low = low;
            low
        })
    }

    fn resized(&mut self, minimized: bool) -> Option<bool> {
        self.minimized = minimized;
        self.change()
    }

    /// A focus change. Returns the ticket for the away countdown a blur starts.
    fn focused(&mut self, focused: bool) -> (u64, Option<bool>) {
        self.ticket += 1;
        if focused {
            self.away = false;
        }
        (self.ticket, self.change())
    }

    /// The countdown for `ticket` ran out; it counts only if focus has not changed since.
    fn away_elapsed(&mut self, ticket: u64) -> Option<bool> {
        if ticket != self.ticket {
            return None;
        }
        self.away = true;
        self.change()
    }
}

/// Watches the main window and switches the WebView2 memory target as it is minimized, restored,
/// or left in the background. Each switch is sent once per change.
#[cfg(windows)]
pub fn watch(window: &tauri::WebviewWindow) {
    use std::sync::{Arc, Mutex};
    let idle = Arc::new(Mutex::new(Idle::default()));
    let watched = window.clone();
    window.on_window_event(move |event| {
        let change = match event {
            // Minimize and restore arrive as resizes on Windows (to and from 0x0).
            tauri::WindowEvent::Resized(_) => {
                let minimized = watched.is_minimized().unwrap_or(false);
                lock(&idle).resized(minimized)
            }
            tauri::WindowEvent::Focused(focused) => {
                let (ticket, change) = lock(&idle).focused(*focused);
                if !*focused {
                    let (idle, window) = (Arc::clone(&idle), watched.clone());
                    drop(tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(AWAY_AFTER).await;
                        if let Some(low) = lock(&idle).away_elapsed(ticket) {
                            set_target(&window, low);
                        }
                    }));
                }
                change
            }
            _ => None,
        };
        if let Some(low) = change {
            set_target(&watched, low);
        }
    });
}

/// A poisoned lock still holds a usable state; the memory target is best effort.
#[cfg(windows)]
fn lock(idle: &std::sync::Mutex<Idle>) -> std::sync::MutexGuard<'_, Idle> {
    idle.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimizing_goes_low_at_once_and_restore_goes_back() {
        let mut idle = Idle::default();
        assert_eq!(idle.resized(true), Some(true));
        assert_eq!(idle.resized(true), None);
        assert_eq!(idle.resized(false), Some(false));
    }

    #[test]
    fn a_blur_goes_low_only_when_its_countdown_ends() {
        let mut idle = Idle::default();
        let (t, c) = idle.focused(false);
        assert_eq!(c, None);
        assert_eq!(idle.away_elapsed(t), Some(true));
    }

    #[test]
    fn focus_back_returns_to_normal_and_voids_the_countdown() {
        let mut idle = Idle::default();
        let (t, _) = idle.focused(false);
        assert_eq!(idle.away_elapsed(t), Some(true));
        let (_, c) = idle.focused(true);
        assert_eq!(c, Some(false));
        assert_eq!(idle.away_elapsed(t), None);
    }

    #[test]
    fn an_old_countdown_after_refocus_and_reblur_does_nothing() {
        let mut idle = Idle::default();
        let (t1, _) = idle.focused(false);
        let _ = idle.focused(true);
        let (t2, _) = idle.focused(false);
        assert_eq!(idle.away_elapsed(t1), None);
        assert_eq!(idle.away_elapsed(t2), Some(true));
    }

    #[test]
    fn restore_while_away_stays_low() {
        let mut idle = Idle::default();
        let (t, _) = idle.focused(false);
        assert_eq!(idle.away_elapsed(t), Some(true));
        assert_eq!(idle.resized(true), None);
        assert_eq!(idle.resized(false), None);
    }

    #[test]
    fn refocus_while_minimized_stays_low() {
        let mut idle = Idle::default();
        assert_eq!(idle.resized(true), Some(true));
        let (_, c) = idle.focused(true);
        assert_eq!(c, None);
    }

    #[test]
    fn the_countdown_is_five_minutes() {
        assert_eq!(AWAY_AFTER, Duration::from_secs(300));
    }
}
