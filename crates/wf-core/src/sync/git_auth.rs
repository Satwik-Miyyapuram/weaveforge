//! Git remote credentials for the vault mirror (port of `basicAuth` and `remoteAuth` in
//! `apps/shell/sidecar/src/vault-git.ts`). The token travels as an HTTP header through git's
//! environment config, never on the command line or in `.git/config`. Spawning git stays in TypeScript.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::bytea::encode_base64;
use crate::sync::mattermost_post::http_origin;

/// The user name sent with a token when the remote names none (GitHub, GitLab and Gitea accept it).
pub const DEFAULT_USERNAME: &str = "x-access-token";

/// Input for [`remote_auth`]: the remote URL and its optional credentials.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAuthInput {
    /// The remote URL as stored.
    pub url: String,
    /// The access token. Empty or absent means no credentials are sent.
    pub token: Option<String>,
    /// The user name paired with the token. Absent uses [`DEFAULT_USERNAME`]; empty is kept as is.
    pub username: Option<String>,
}

/// The git arguments and environment overrides for one remote command.
///
/// `env` holds only the keys to set on top of the process environment, so the caller copies its own
/// environment and merges these in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAuthPlan {
    /// Arguments to put before the git subcommand.
    pub flags: Vec<String>,
    /// Environment keys to set. Always includes `GIT_TERMINAL_PROMPT`.
    pub env: BTreeMap<String, String>,
}

/// `Authorization` value body: base64 of `username:token`, as HTTP basic auth.
///
/// GitHub, GitLab and Gitea take the token as the password under any user name; Overleaf wants `git`.
/// An absent user name means [`DEFAULT_USERNAME`].
#[must_use]
pub fn basic_auth(token: &str, username: Option<&str>) -> String {
    let user = username.unwrap_or(DEFAULT_USERNAME);
    encode_base64(format!("{user}:{token}").as_bytes())
}

/// Credentials for one remote: the token as a scoped header, or nothing.
///
/// The header is keyed to the remote's own origin (`http.<origin>/.extraHeader`), so a redirect or
/// submodule on another host never receives it. With a token, the credential helper is switched off
/// so a wrong token fails here instead of opening a sign-in window. A remote that is not http(s)
/// gets no header, and an empty token counts as no token.
#[must_use]
pub fn remote_auth(input: &RemoteAuthInput) -> RemoteAuthPlan {
    let mut env = BTreeMap::new();
    let _ = env.insert("GIT_TERMINAL_PROMPT".to_owned(), "0".to_owned());
    let token = input.token.as_deref().filter(|t| !t.is_empty());
    match (token, http_origin(&input.url)) {
        (Some(token), Some(origin)) => {
            let _ = env.insert("GIT_CONFIG_COUNT".to_owned(), "1".to_owned());
            let _ = env.insert(
                "GIT_CONFIG_KEY_0".to_owned(),
                format!("http.{origin}/.extraHeader"),
            );
            let _ = env.insert(
                "GIT_CONFIG_VALUE_0".to_owned(),
                format!(
                    "Authorization: Basic {}",
                    basic_auth(token, input.username.as_deref())
                ),
            );
            RemoteAuthPlan {
                flags: vec!["-c".to_owned(), "credential.helper=".to_owned()],
                env,
            }
        }
        _ => RemoteAuthPlan {
            flags: Vec::new(),
            env,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(url: &str, token: Option<&str>, username: Option<&str>) -> RemoteAuthInput {
        RemoteAuthInput {
            url: url.to_owned(),
            token: token.map(str::to_owned),
            username: username.map(str::to_owned),
        }
    }

    #[test]
    fn basic_auth_defaults_to_x_access_token() {
        // base64("x-access-token:tok")
        assert_eq!(basic_auth("tok", None), "eC1hY2Nlc3MtdG9rZW46dG9r");
    }

    #[test]
    fn basic_auth_uses_a_given_username_even_when_empty() {
        // base64("git:tok") and base64(":tok")
        assert_eq!(basic_auth("tok", Some("git")), "Z2l0OnRvaw==");
        assert_eq!(basic_auth("tok", Some("")), "OnRvaw==");
    }

    #[test]
    fn token_becomes_a_scoped_header_with_the_helper_off() {
        let plan = remote_auth(&input(
            "https://git.example.com:8443/org/repo.git",
            Some("tok"),
            None,
        ));
        assert_eq!(plan.flags, vec!["-c", "credential.helper="]);
        assert_eq!(plan.env["GIT_TERMINAL_PROMPT"], "0");
        assert_eq!(plan.env["GIT_CONFIG_COUNT"], "1");
        assert_eq!(
            plan.env["GIT_CONFIG_KEY_0"],
            "http.https://git.example.com:8443/.extraHeader"
        );
        assert_eq!(
            plan.env["GIT_CONFIG_VALUE_0"],
            format!("Authorization: Basic {}", basic_auth("tok", None))
        );
    }

    #[test]
    fn no_token_or_empty_token_sends_no_credentials() {
        for token in [None, Some("")] {
            let plan = remote_auth(&input("https://x.example", token, None));
            assert!(plan.flags.is_empty());
            assert_eq!(plan.env.len(), 1);
            assert_eq!(plan.env["GIT_TERMINAL_PROMPT"], "0");
        }
    }

    #[test]
    fn non_http_remote_gets_no_header() {
        let plan = remote_auth(&input("git@github.com:org/repo.git", Some("tok"), None));
        assert!(plan.flags.is_empty());
        assert!(!plan.env.contains_key("GIT_CONFIG_COUNT"));
    }

    #[test]
    fn the_username_reaches_the_header() {
        let plan = remote_auth(&input("https://ov.example", Some("tok"), Some("git")));
        assert_eq!(
            plan.env["GIT_CONFIG_VALUE_0"],
            format!("Authorization: Basic {}", basic_auth("tok", Some("git")))
        );
    }
}
