//! Which sync connection fields to ask for (TS `sync-settings` `fieldsShown`). Mattermost
//! sign-in brings its own token, so in that mode only the other fields are asked for.

/// The field key that Mattermost sign-in supplies itself.
const TOKEN_KEY: &str = "token";

/// Whether the connection field with `key` is asked for. In Mattermost sign-in mode the
/// `token` field is hidden; every other field is shown in both modes.
#[must_use]
pub fn field_shown(key: &str, mattermost_sign_in: bool) -> bool {
    !(mattermost_sign_in && key == TOKEN_KEY)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_hidden_only_in_mattermost_sign_in() {
        assert!(!field_shown("token", true));
        assert!(field_shown("token", false));
    }

    #[test]
    fn other_fields_are_always_shown() {
        for mode in [true, false] {
            assert!(field_shown("repo", mode));
            assert!(field_shown("branch", mode));
            assert!(field_shown("", mode));
        }
    }
}
