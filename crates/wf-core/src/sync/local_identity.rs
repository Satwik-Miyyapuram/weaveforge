//! Ports the local-mode decision of `apps/web/src/backend/providers/local/local-identity.ts`:
//! the localStorage key of the local-mode choice and whether its stored value turns local
//! mode on. The localStorage read stays in TypeScript.

/// The localStorage key of the local-mode choice (`"1"` when on).
pub const LOCAL_MODE_KEY: &str = "weaveforge.local-mode";

/// Whether the stored local-mode value means local mode is on: only `"1"` does.
#[must_use]
pub fn is_local_mode(stored: Option<&str>) -> bool {
    stored == Some("1")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_mode_is_on_only_for_the_stored_one() {
        assert!(is_local_mode(Some("1")));
        assert!(!is_local_mode(Some("0")));
        assert!(!is_local_mode(Some("")));
        assert!(!is_local_mode(Some("true")));
        assert!(!is_local_mode(None));
    }
}
