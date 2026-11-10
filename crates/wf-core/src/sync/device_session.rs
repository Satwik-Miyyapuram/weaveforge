//! Which signed-in session drives this device's sync (`ui/sync-loop.tsx`). The
//! device adopts one account; only that account's session runs the loop.

/// What a window does for the session it holds: the device's account drives it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionAction {
    /// No one is signed in, so the loop does nothing.
    Idle,
    /// Signed in on a device with no account adopted yet: adopt this account.
    Adopt,
    /// The signed-in account is the adopted one: drive the sync.
    Drive,
    /// Another account is signed in on an adopted device: leave the loop alone.
    Foreign,
}

impl SessionAction {
    /// The name the TypeScript side uses for this action.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Adopt => "adopt",
            Self::Drive => "drive",
            Self::Foreign => "foreign",
        }
    }
}

/// True when the signed-in user is the account this device adopted (TS `mayDriveDevice`).
/// Both ids must be present and equal; no adopted account means nothing may drive.
#[must_use]
pub fn may_drive_device(signed_in_user_id: Option<&str>, adopted_account_id: Option<&str>) -> bool {
    matches!((signed_in_user_id, adopted_account_id), (Some(user), Some(account)) if user == account)
}

/// What the session does for this device (TS `sessionAction`). An empty user id
/// counts as signed out, as the falsy check in the TypeScript always did.
#[must_use]
pub fn session_action(
    signed_in_user_id: Option<&str>,
    adopted_account_id: Option<&str>,
) -> SessionAction {
    let user = match signed_in_user_id {
        Some(user) if !user.is_empty() => user,
        _ => return SessionAction::Idle,
    };
    match adopted_account_id {
        None => SessionAction::Adopt,
        Some(_) if may_drive_device(Some(user), adopted_account_id) => SessionAction::Drive,
        Some(_) => SessionAction::Foreign,
    }
}

#[cfg(test)]
mod tests {
    use super::{SessionAction, may_drive_device, session_action};

    #[test]
    fn only_the_adopted_account_drives() {
        assert!(may_drive_device(Some("a"), Some("a")));
        assert!(!may_drive_device(Some("b"), Some("a")));
        assert!(!may_drive_device(None, Some("a")));
        assert!(!may_drive_device(Some("a"), None));
    }

    #[test]
    fn session_action_covers_each_case() {
        assert_eq!(session_action(Some("a"), None), SessionAction::Adopt);
        assert_eq!(session_action(Some("a"), Some("a")), SessionAction::Drive);
        assert_eq!(session_action(Some("b"), Some("a")), SessionAction::Foreign);
        assert_eq!(session_action(None, Some("a")), SessionAction::Idle);
        assert_eq!(session_action(None, None), SessionAction::Idle);
        assert_eq!(session_action(Some(""), None), SessionAction::Idle);
    }

    #[test]
    fn names_match_the_typescript_union() {
        assert_eq!(SessionAction::Foreign.name(), "foreign");
    }
}
