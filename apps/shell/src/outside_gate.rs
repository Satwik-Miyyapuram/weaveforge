//! One gate for every link or popup the app hands to the OS: at most one per second, shared by
//! the main window and the sign-in windows, so a page cannot flood the browser with tabs.

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The shortest gap between two outside opens.
pub const MIN_GAP: Duration = Duration::from_secs(1);

static LAST_OPEN: Mutex<Option<Instant>> = Mutex::new(None);

/// Whether an open at `now` may go ahead after one at `last`; on yes, `last` becomes `now`.
pub fn admit(last: &mut Option<Instant>, now: Instant) -> bool {
    if last.is_some_and(|at| now.saturating_duration_since(at) < MIN_GAP) {
        return false;
    }
    *last = Some(now);
    true
}

/// The shared gate, checked at the moment of an open. A poisoned lock refuses.
pub fn admit_now() -> bool {
    LAST_OPEN
        .lock()
        .map(|mut last| admit(&mut last, Instant::now()))
        .unwrap_or(false)
}

/// Whether a link is a `mailto:` address, which goes to the OS mail app.
#[must_use]
pub fn is_mail_link(url: &tauri::Url) -> bool {
    url.scheme() == "mailto" && !url.path().is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_open_passes_then_one_per_second() {
        let start = Instant::now();
        let mut last = None;
        assert!(admit(&mut last, start));
        assert!(!admit(&mut last, start + Duration::from_millis(300)));
        assert!(!admit(&mut last, start + Duration::from_millis(999)));
        assert!(admit(&mut last, start + MIN_GAP));
        assert!(!admit(
            &mut last,
            start + MIN_GAP + Duration::from_millis(10)
        ));
    }

    #[test]
    fn a_refused_open_does_not_push_the_window_back() {
        let start = Instant::now();
        let mut last = None;
        assert!(admit(&mut last, start));
        assert!(!admit(&mut last, start + Duration::from_millis(900)));
        assert!(admit(&mut last, start + Duration::from_millis(1000)));
    }

    #[test]
    fn mail_links_only_with_an_address() {
        let is = |raw: &str| {
            tauri::Url::parse(raw)
                .map(|u| is_mail_link(&u))
                .unwrap_or(false)
        };
        assert!(is("mailto:someone@example.org"));
        assert!(is("mailto:someone@example.org?subject=Hi"));
        assert!(!is("mailto:"));
        assert!(!is("https://example.org/mailto:x"));
        assert!(!is("javascript:alert(1)"));
    }
}
