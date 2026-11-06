//! Overleaf sign-in in a window of its own. The session cookie is read from that window,
//! checked with Overleaf and kept in the shell's Workshop sessions; the page only gets the
//! opaque session id, never the cookie.

use std::time::Duration;

use tauri::Manager;

use crate::app_route::AppRoutes;
use crate::commands::ShellError;
use crate::mattermost::{
    SignInSlot, SignInWindow, WindowCookies, open_window, shared_sign_in, wait_for_token,
};

/// The sign-in window could not be opened.
pub const SIGN_IN_NOT_OPENED: &str = "Could not open the Overleaf sign-in window.";
/// The shell has no network client for Overleaf.
pub const OVERLEAF_UNREACHABLE: &str = "Could not reach Overleaf.";

const SITE: &str = "https://www.overleaf.com/";
const LOGIN: &str = "https://www.overleaf.com/login";
const SESSION_COOKIE: &str = "overleaf_session2";
const WINDOW: SignInWindow = SignInWindow {
    label: "overleaf-signin",
    title: "Sign in to Overleaf",
};
const POLL: Duration = Duration::from_secs(1);
const GIVE_UP: Duration = Duration::from_secs(10 * 60);

/// The one Overleaf sign-in at a time; a second click joins it.
static IN_FLIGHT: SignInSlot = std::sync::Mutex::new(None);

/// The `cookie` header Overleaf expects for a session cookie value.
#[must_use]
pub fn cookie_header(value: &str) -> String {
    format!("{SESSION_COOKIE}={value}")
}

/// Opens the window (or joins the open one), waits for a signed-in session cookie, and keeps it.
/// The anonymous cookie Overleaf sets before sign-in fails the check and is skipped until it
/// changes, which Overleaf does on sign-in.
async fn sign_in_window(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    let routes = app
        .try_state::<AppRoutes>()
        .ok_or_else(|| OVERLEAF_UNREACHABLE.to_owned())?;
    let client = routes
        .relay_client
        .clone()
        .ok_or_else(|| OVERLEAF_UNREACHABLE.to_owned())?;
    let login = tauri::Url::parse(LOGIN).map_err(|_| SIGN_IN_NOT_OPENED.to_owned())?;
    if app.get_webview_window(WINDOW.label).is_none() {
        open_window(app, &WINDOW, login).map_err(|()| SIGN_IN_NOT_OPENED.to_owned())?;
    }
    let cookies = WindowCookies {
        app: app.clone(),
        server: tauri::Url::parse(SITE).map_err(|_| SIGN_IN_NOT_OPENED.to_owned())?,
        label: WINDOW.label,
        cookie: SESSION_COOKIE,
    };
    // The check keeps the first cookie Overleaf accepts, so the session id is known once it passes.
    let kept: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
    let (client_ref, kept_ref, workshop) = (&client, &kept, &routes.workshop);
    let accepted = wait_for_token(
        &cookies,
        |value: String| async move {
            match crate::overleaf_workshop::start_session(
                client_ref,
                workshop,
                &cookie_header(&value),
            )
            .await
            {
                Ok(id) => {
                    if let Ok(mut slot) = kept_ref.lock() {
                        *slot = Some(id);
                    }
                    true
                }
                Err(_) => false,
            }
        },
        POLL,
        GIVE_UP,
    )
    .await;
    if let Some(window) = app.get_webview_window(WINDOW.label) {
        let _ = window.close();
    }
    let id = kept.lock().ok().and_then(|mut slot| slot.take());
    Ok(accepted.and(id))
}

/// Opens the Overleaf sign-in window and answers a Workshop session id, or null if it was closed.
///
/// # Errors
/// `SIGN_IN_NOT_OPENED` or `OVERLEAF_UNREACHABLE`, as the message the page shows.
#[tauri::command]
#[specta::specta]
pub async fn overleaf_sign_in(app: tauri::AppHandle) -> Result<Option<String>, ShellError> {
    shared_sign_in(&IN_FLIGHT, || sign_in_window(&app))
        .await
        .map_err(ShellError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_header_names_the_overleaf_session_cookie() {
        assert_eq!(cookie_header("s%3Aabc"), "overleaf_session2=s%3Aabc");
    }

    #[test]
    fn window_has_its_own_label() {
        assert_eq!(WINDOW.label, "overleaf-signin");
        assert_ne!(WINDOW.label, "mattermost-signin");
    }
}
