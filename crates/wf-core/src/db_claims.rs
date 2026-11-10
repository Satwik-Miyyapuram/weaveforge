//! The `request.jwt.claims` JSON that row-level security policies read
//! (TS before this port: `sessionClaims` in `packages/core/src/database/local-postgres.ts`).

/// The claims JSON for a user. `None` or an empty id is a request with no identity (`anon`),
/// which policies refuse.
///
/// Key order is `sub` then `role`, as `JSON.stringify` produced it.
#[must_use]
pub fn session_claims(user: Option<&str>) -> String {
    match user {
        Some(id) if !id.is_empty() => format!(
            r#"{{"sub":{},"role":"authenticated"}}"#,
            serde_json::to_string(id).unwrap_or_default()
        ),
        _ => r#"{"role":"anon"}"#.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::session_claims;

    #[test]
    fn user_gets_sub_then_role() {
        assert_eq!(
            session_claims(Some("u1")),
            r#"{"sub":"u1","role":"authenticated"}"#
        );
    }

    #[test]
    fn none_and_empty_are_anon() {
        assert_eq!(session_claims(None), r#"{"role":"anon"}"#);
        assert_eq!(session_claims(Some("")), r#"{"role":"anon"}"#);
    }

    #[test]
    fn id_is_json_escaped() {
        assert_eq!(
            session_claims(Some("a\"b\\c")),
            r#"{"sub":"a\"b\\c","role":"authenticated"}"#
        );
    }
}
