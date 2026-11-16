//! Gate for the privacy-disclaimer shell, ported from
//! `apps/web/src/features/auth/ui/privacy-disclaimer-readiness.ts`. Pure: no I/O.
//!
//! When a cached startup snapshot says the disclaimer is already accepted, shell children
//! must still wait for the full container (cold reopen, TWA, website).

/// Whether the shell's children may mount.
#[must_use]
pub fn should_mount_shell_children(
    loading: bool,
    needs_privacy_accept: bool,
    container_ready: bool,
) -> bool {
    !loading && !needs_privacy_accept && container_ready
}

/// Whether the workspace loader shows. `has_error` is true when a startup error is present;
/// the loader then yields to the error instead.
#[must_use]
pub fn should_show_workspace_loader(
    loading: bool,
    needs_privacy_accept: bool,
    container_ready: bool,
    has_error: bool,
) -> bool {
    if loading {
        return true;
    }
    !needs_privacy_accept && !container_ready && !has_error
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn children_mount_only_when_loaded_accepted_and_ready() {
        assert!(should_mount_shell_children(false, false, true));
        assert!(!should_mount_shell_children(true, false, true));
        assert!(!should_mount_shell_children(false, true, true));
        assert!(!should_mount_shell_children(false, false, false));
    }

    #[test]
    fn loader_shows_while_loading() {
        assert!(should_show_workspace_loader(true, true, true, true));
        assert!(should_show_workspace_loader(true, false, false, false));
    }

    #[test]
    fn loader_shows_while_container_is_not_ready_and_no_error() {
        assert!(should_show_workspace_loader(false, false, false, false));
        assert!(!should_show_workspace_loader(false, false, false, true));
        assert!(!should_show_workspace_loader(false, true, false, false));
        assert!(!should_show_workspace_loader(false, false, true, false));
    }
}
