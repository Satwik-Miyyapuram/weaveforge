//! Mattermost post rules (TS `features/sync/infrastructure/mattermost-notifier.ts` and
//! `mattermost-test-post.ts`): the channel a post goes to, the server origin check, the
//! response check and the test-post grouping. The fetch, the desktop bridge and the
//! signed-out event stay in TypeScript.

use serde::{Deserialize, Serialize};

use super::integration_fields::Integration;
use super::mattermost_options::{mattermost_channel_for, mattermost_events};
use crate::search::js_text::is_js_whitespace;

/// Message when the server URL is not an http(s) URL.
pub const INVALID_SERVER_URL_MESSAGE: &str = "Mattermost server URL must be a valid http(s) URL.";

/// Input for [`post_plan`]: the connection and the per-post channel override.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MattermostPostInput {
    /// Server URL as stored.
    pub server_url: String,
    /// Channel the caller wants this post in. `None` or blank uses the main channel.
    pub channel: Option<String>,
    /// The connection's main channel id.
    pub main_channel: String,
}

/// Where one post goes, or why it cannot be sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MattermostPostPlan {
    /// Channel id the post is sent to.
    pub channel_id: String,
    /// `scheme://host[:port]` the request is sent to. `None` when the URL is not http(s).
    pub origin: Option<String>,
    /// Why `origin` is `None`. Set exactly when `origin` is.
    pub error: Option<String>,
}

/// The HTTP status and body of a Mattermost post response.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MattermostPostResponse {
    /// HTTP status code.
    pub status: u16,
    /// Response body text (empty on success).
    pub body: String,
}

/// What to do with a post response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MattermostPostResponsePlan {
    /// True on 401 or 403: the session is gone and the UI should offer re-sign-in.
    pub signed_out: bool,
    /// The error to throw. `None` on a 2xx status.
    pub error: Option<String>,
}

/// One test post: the channel and the message to send there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MattermostTestPost {
    /// Channel id to post to.
    pub channel: String,
    /// Test message listing the events that route there.
    pub message: String,
}

/// The channel and origin for one post (TS `post`, before the request).
#[must_use]
pub fn post_plan(input: &MattermostPostInput) -> MattermostPostPlan {
    let channel_id = match input
        .channel
        .as_deref()
        .map(|c| c.trim_matches(is_js_whitespace))
    {
        Some(c) if !c.is_empty() => c.to_owned(),
        _ => input.main_channel.clone(),
    };
    match http_origin(&input.server_url) {
        Some(origin) => MattermostPostPlan {
            channel_id,
            origin: Some(origin),
            error: None,
        },
        None => MattermostPostPlan {
            channel_id,
            origin: None,
            error: Some(INVALID_SERVER_URL_MESSAGE.to_owned()),
        },
    }
}

/// The origin of an http(s) URL, or `None` for anything else (JS `new URL`, `.origin`).
pub(crate) fn http_origin(raw: &str) -> Option<String> {
    let url = url::Url::parse(raw).ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.origin().ascii_serialization())
}

/// What to do with a post response (TS `post`, after the request).
#[must_use]
pub fn post_response_plan(input: &MattermostPostResponse) -> MattermostPostResponsePlan {
    if (200..300).contains(&input.status) {
        return MattermostPostResponsePlan {
            signed_out: false,
            error: None,
        };
    }
    MattermostPostResponsePlan {
        signed_out: matches!(input.status, 401 | 403),
        error: Some(
            format!("Mattermost post failed ({}). {}", input.status, input.body)
                .trim_matches(is_js_whitespace)
                .to_owned(),
        ),
    }
}

/// One test post per distinct channel the switched-on events route to, in first-seen
/// order (TS `postMattermostTest` grouping).
#[must_use]
pub fn test_posts(integration: &Integration) -> Vec<MattermostTestPost> {
    let mut groups: Vec<(String, Vec<String>)> = Vec::new();
    for event in mattermost_events() {
        let Some(channel) = mattermost_channel_for(integration, event.id) else {
            continue;
        };
        match groups.iter().position(|(c, _)| *c == channel) {
            Some(index) => groups[index].1.push(event.label),
            None => groups.push((channel, vec![event.label])),
        }
    }
    groups
        .into_iter()
        .map(|(channel, labels)| MattermostTestPost {
            channel,
            message: format!(
                ":white_check_mark: WeaveForge test. This channel will receive: {}.",
                labels.join(", ")
            ),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn post(server_url: &str, channel: Option<&str>) -> MattermostPostInput {
        MattermostPostInput {
            server_url: server_url.to_owned(),
            channel: channel.map(str::to_owned),
            main_channel: "main-ch".to_owned(),
        }
    }

    #[test]
    fn blank_or_absent_channel_uses_main_channel() {
        assert_eq!(post_plan(&post("https://x", None)).channel_id, "main-ch");
        assert_eq!(
            post_plan(&post("https://x", Some("  "))).channel_id,
            "main-ch"
        );
        assert_eq!(post_plan(&post("https://x", Some(" ov "))).channel_id, "ov");
    }

    #[test]
    fn origin_drops_path_and_keeps_port() {
        let plan = post_plan(&post("https://chat.example.com:8065/some/path", None));
        assert_eq!(
            plan.origin.as_deref(),
            Some("https://chat.example.com:8065")
        );
        assert_eq!(plan.error, None);
    }

    #[test]
    fn non_http_urls_are_rejected_with_message() {
        for raw in ["ftp://x", "javascript:alert(1)", "not a url", ""] {
            let plan = post_plan(&post(raw, None));
            assert_eq!(plan.origin, None, "{raw}");
            assert_eq!(
                plan.error.as_deref(),
                Some(INVALID_SERVER_URL_MESSAGE),
                "{raw}"
            );
        }
    }

    #[test]
    fn success_status_has_no_error() {
        let plan = post_response_plan(&MattermostPostResponse {
            status: 201,
            body: String::new(),
        });
        assert_eq!(
            plan,
            MattermostPostResponsePlan {
                signed_out: false,
                error: None
            }
        );
    }

    #[test]
    fn auth_failures_flag_signed_out() {
        for status in [401, 403] {
            let plan = post_response_plan(&MattermostPostResponse {
                status,
                body: "nope".to_owned(),
            });
            assert!(plan.signed_out);
            assert_eq!(
                plan.error,
                Some(format!("Mattermost post failed ({status}). nope"))
            );
        }
    }

    #[test]
    fn other_failures_keep_status_and_trim_body() {
        let plan = post_response_plan(&MattermostPostResponse {
            status: 500,
            body: " boom \n".to_owned(),
        });
        assert!(!plan.signed_out);
        assert_eq!(
            plan.error.as_deref(),
            // Only the whole message is trimmed, as in TS, so the body's leading space stays.
            Some("Mattermost post failed (500).  boom")
        );
        let empty = post_response_plan(&MattermostPostResponse {
            status: 404,
            body: String::new(),
        });
        assert_eq!(
            empty.error.as_deref(),
            Some("Mattermost post failed (404).")
        );
    }

    fn integration(channel: &str, same_channel: bool) -> Integration {
        Integration {
            enabled: true,
            token: Some("bot".to_owned()),
            repo: Some("https://chat.example.com".to_owned()),
            branch: channel.to_owned(),
            options: Some(serde_json::json!({
                "sameChannel": same_channel,
                "events": { "dailyLogs": true, "weeklyLogs": true },
                "channels": {}
            })),
        }
    }

    #[test]
    fn events_on_one_channel_group_into_one_post() {
        let posts = test_posts(&integration("chan-1", true));
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].channel, "chan-1");
        assert_eq!(
            posts[0].message,
            ":white_check_mark: WeaveForge test. This channel will receive: Daily log entries, Weekly log entries."
        );
    }

    #[test]
    fn no_switched_on_event_means_no_posts() {
        let mut i = integration("", true);
        i.options = Some(serde_json::json!({ "events": {} }));
        assert!(test_posts(&i).is_empty());
    }
}
