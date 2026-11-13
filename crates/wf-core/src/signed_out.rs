//! Ports `isSignedOutRefusal` in `apps/web/src/lib/parts.ts`: whether a
//! failed server request means the person is signed out, rather than that the
//! request itself was not allowed.

/// Error codes (Postgres `42501`, PostgREST `PGRST301`/`PGRST303`) that mean the
/// request carried no valid sign-in.
const SIGNED_OUT_CODES: [&str; 3] = ["42501", "PGRST301", "PGRST303"];

/// Message fragments that mean the sign-in is gone. Matched on lowercased text.
const SIGNED_OUT_MESSAGES: [&str; 6] = [
    "permission denied for table",
    "permission denied for function",
    "permission denied for sequence",
    "permission denied for schema",
    "jwt expired",
    "session_not_found",
];

/// True when a server refusal, with no sign-in, means "sign in" rather than "not allowed".
#[must_use]
pub fn is_signed_out_refusal(message: &str, code: Option<&str>) -> bool {
    if code.is_some_and(|value| SIGNED_OUT_CODES.contains(&value)) {
        return true;
    }
    let lowered = message.to_ascii_lowercase();
    SIGNED_OUT_MESSAGES
        .iter()
        .any(|needle| lowered.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::is_signed_out_refusal;

    #[test]
    fn signed_out_codes_refuse_without_a_message() {
        assert!(is_signed_out_refusal("", Some("42501")));
        assert!(is_signed_out_refusal("", Some("PGRST301")));
        assert!(is_signed_out_refusal("", Some("PGRST303")));
    }

    #[test]
    fn permission_denied_messages_refuse() {
        assert!(is_signed_out_refusal(
            "permission denied for table projects",
            None
        ));
        assert!(is_signed_out_refusal(
            "permission denied for function rpc_x",
            None
        ));
        assert!(is_signed_out_refusal(
            "Permission Denied For Sequence ids",
            None
        ));
        assert!(is_signed_out_refusal(
            "permission denied for schema public",
            None
        ));
    }

    #[test]
    fn expired_jwt_and_missing_session_refuse() {
        assert!(is_signed_out_refusal("JWT expired", None));
        assert!(is_signed_out_refusal("error: session_not_found", None));
    }

    #[test]
    fn other_errors_do_not_refuse() {
        assert!(!is_signed_out_refusal("duplicate key value", None));
        assert!(!is_signed_out_refusal("permission denied", None));
        assert!(!is_signed_out_refusal(
            "permission denied for database x",
            None
        ));
        assert!(!is_signed_out_refusal("", Some("23505")));
        assert!(!is_signed_out_refusal("", None));
    }
}
