//! Ports `nextAuthStep` in `apps/web/src/features/auth/domain/parts.ts`:
//! what a session change means for the app. Only ids and flags are decided
//! here; the caller builds the user object for the step it gets back.

use serde::{Deserialize, Serialize};

/// The facts a session change is decided from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthTransitionInput<'a> {
    /// Id of the user the auth service reports; `None` when there is no session.
    pub user_id: Option<&'a str>,
    /// Id of the last user the app showed.
    pub previous_id: Option<&'a str>,
    /// A deliberate sign-out is in progress.
    pub signing_out: bool,
    /// The last session lapsed without a sign-out.
    pub was_expired: bool,
    /// Running in the desktop shell, which has a workspace folder to keep.
    pub desktop: bool,
    /// Id of the account whose copy is on this computer, if any.
    pub local_account_id: Option<&'a str>,
}

/// What the app does with a session change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AuthStep {
    /// Open with the local copy's account, offline.
    Offline,
    /// The session lapsed on the desktop: keep the work and ask to sign in again.
    Expired,
    /// Clear the session.
    SignedOut,
    /// This window reads another account's copy: start over against the server.
    OtherAccountOnDisk,
    /// Signed in as `user_id`.
    #[serde(rename_all = "camelCase")]
    SignedIn {
        /// Signing in as someone else: drop the last user's caches.
        clear_caches: bool,
        /// Back from a lapsed session as the same person: every screen asks again.
        refetch: bool,
    },
}

/// Decide what a session change means for the app.
#[must_use]
pub fn next_auth_step(input: AuthTransitionInput<'_>) -> AuthStep {
    let Some(user_id) = input.user_id else {
        // A desktop working on its own copy opens with that account even when
        // the session is gone; only syncing it needs a sign-in.
        if input.previous_id.is_none() && !input.signing_out && input.local_account_id.is_some() {
            return AuthStep::Offline;
        }
        // An expired session on the desktop is not a sign-out: keep everything.
        if input.previous_id.is_some() && !input.signing_out && input.desktop {
            return AuthStep::Expired;
        }
        return AuthStep::SignedOut;
    };
    if let Some(local) = input.local_account_id
        && local != user_id
    {
        return AuthStep::OtherAccountOnDisk;
    }
    let clear_caches = input
        .previous_id
        .is_some_and(|previous| previous != user_id);
    let refetch = !clear_caches && input.was_expired;
    AuthStep::SignedIn {
        clear_caches,
        refetch,
    }
}

#[cfg(test)]
mod tests {
    use super::{AuthStep, AuthTransitionInput, next_auth_step};

    fn input() -> AuthTransitionInput<'static> {
        AuthTransitionInput {
            user_id: None,
            previous_id: None,
            signing_out: false,
            was_expired: false,
            desktop: false,
            local_account_id: None,
        }
    }

    #[test]
    fn no_session_and_no_local_copy_signs_out() {
        assert_eq!(next_auth_step(input()), AuthStep::SignedOut);
    }

    #[test]
    fn local_copy_opens_offline_without_session() {
        let step = next_auth_step(AuthTransitionInput {
            local_account_id: Some("ada"),
            ..input()
        });
        assert_eq!(step, AuthStep::Offline);
    }

    #[test]
    fn deliberate_sign_out_ignores_local_copy() {
        let step = next_auth_step(AuthTransitionInput {
            local_account_id: Some("ada"),
            signing_out: true,
            ..input()
        });
        assert_eq!(step, AuthStep::SignedOut);
    }

    #[test]
    fn lapsed_session_on_desktop_expires_and_in_browser_signs_out() {
        let desktop = AuthTransitionInput {
            previous_id: Some("ada"),
            desktop: true,
            ..input()
        };
        assert_eq!(next_auth_step(desktop), AuthStep::Expired);
        let browser = AuthTransitionInput {
            previous_id: Some("ada"),
            ..input()
        };
        assert_eq!(next_auth_step(browser), AuthStep::SignedOut);
    }

    #[test]
    fn other_accounts_copy_on_disk_starts_over() {
        let step = next_auth_step(AuthTransitionInput {
            user_id: Some("bob"),
            local_account_id: Some("ada"),
            ..input()
        });
        assert_eq!(step, AuthStep::OtherAccountOnDisk);
    }

    #[test]
    fn first_sign_in_keeps_caches() {
        let step = next_auth_step(AuthTransitionInput {
            user_id: Some("ada"),
            ..input()
        });
        assert_eq!(
            step,
            AuthStep::SignedIn {
                clear_caches: false,
                refetch: false
            }
        );
    }

    #[test]
    fn different_user_clears_caches_and_same_user_after_lapse_refetches() {
        let other = AuthTransitionInput {
            user_id: Some("bob"),
            previous_id: Some("ada"),
            was_expired: true,
            ..input()
        };
        assert_eq!(
            next_auth_step(other),
            AuthStep::SignedIn {
                clear_caches: true,
                refetch: false
            }
        );
        let same = AuthTransitionInput {
            user_id: Some("ada"),
            previous_id: Some("ada"),
            was_expired: true,
            ..input()
        };
        assert_eq!(
            next_auth_step(same),
            AuthStep::SignedIn {
                clear_caches: false,
                refetch: true
            }
        );
    }
}
