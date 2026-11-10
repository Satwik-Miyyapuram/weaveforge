//! Sidebar Inbox links and account-menu attention, ported from
//! `apps/web/src/app/inbox-links.ts` and `apps/web/src/app/account-attention.ts`.
//! Pure: the counts and flags are passed in, so no account or storage is read here.

use serde::{Deserialize, Serialize};

/// Who is looking at the Inbox, and what is waiting for them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct InboxInput {
    /// Professors and PhDs get the supervisor view; Master's students do not.
    pub can_supervise: bool,
    /// AI suggestions waiting for review; shown as a badge when positive.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub pending_proposals: i64,
    /// No account on this computer: nothing can be shared with it.
    pub local: bool,
}

/// One row of the Inbox group or the account menu.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct InboxLink {
    /// Stable key for the row, for example `ai-review`.
    pub key: String,
    /// The text the row shows.
    pub label: String,
    /// The route the row opens.
    pub path: String,
    /// The icon name the row shows.
    pub icon: String,
    /// Count shown on the row; absent when there is nothing waiting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = u32, optional))]
    pub badge: Option<i64>,
}

/// The inputs for the account icon's count and the top of its menu.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AccountAttentionInput {
    /// Sync conflicts waiting on this device.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub conflicts: i64,
    /// The Inbox rows, with their badges.
    pub inbox: Vec<InboxLink>,
    /// The menu already lists every Inbox row (phone, project picker).
    pub inbox_in_menu: bool,
}

/// What needs the person: the rows for the menu top and the icon's total.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AccountAttention {
    /// Rows to list at the top of the menu.
    pub rows: Vec<InboxLink>,
    /// The count for the account icon.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub total: i64,
}

/// The Inbox rows for this person. The AI row is always first; the shared
/// row follows, and the supervisor row is added for supervisors. A local
/// account (no sign-in) gets the AI row only.
#[must_use]
pub fn inbox_links(input: &InboxInput) -> Vec<InboxLink> {
    let mut links = vec![InboxLink {
        key: "ai-review".to_owned(),
        label: "AI suggestions".to_owned(),
        path: "/ai-review".to_owned(),
        icon: "sparkle".to_owned(),
        badge: (input.pending_proposals > 0).then_some(input.pending_proposals),
    }];
    if input.local {
        return links;
    }
    links.push(InboxLink {
        key: "shared".to_owned(),
        label: "Shared with you".to_owned(),
        path: "/shared".to_owned(),
        icon: "share".to_owned(),
        badge: None,
    });
    if input.can_supervise {
        links.push(InboxLink {
            key: "supervision".to_owned(),
            label: "Supervision".to_owned(),
            path: "/supervision".to_owned(),
            icon: "people".to_owned(),
            badge: None,
        });
    }
    links
}

/// What needs the person, for the account icon's count and the top of its menu.
/// Only rows with a count are attention: a synced device or an empty Inbox
/// puts nothing on the icon.
#[must_use]
pub fn account_attention(input: &AccountAttentionInput) -> AccountAttention {
    let waiting: Vec<InboxLink> = input
        .inbox
        .iter()
        .filter(|row| row.badge.unwrap_or(0) > 0)
        .cloned()
        .collect();
    let waiting_total: i64 = waiting.iter().map(|row| row.badge.unwrap_or(0)).sum();
    let mut rows = Vec::new();
    if input.conflicts > 0 {
        rows.push(InboxLink {
            key: "sync-conflicts".to_owned(),
            label: "Sync conflicts".to_owned(),
            path: "/settings#settings-sync".to_owned(),
            icon: "sync".to_owned(),
            badge: Some(input.conflicts),
        });
    }
    if !input.inbox_in_menu {
        rows.extend(waiting);
    }
    AccountAttention {
        rows,
        total: input.conflicts + waiting_total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> InboxInput {
        InboxInput {
            can_supervise: false,
            pending_proposals: 0,
            local: false,
        }
    }

    fn row(key: &str, badge: Option<i64>) -> InboxLink {
        InboxLink {
            key: key.to_owned(),
            label: key.to_owned(),
            path: format!("/{key}"),
            icon: "x".to_owned(),
            badge,
        }
    }

    fn keys(links: &[InboxLink]) -> Vec<&str> {
        links.iter().map(|l| l.key.as_str()).collect()
    }

    #[test]
    fn plain_account_gets_ai_and_shared_only() {
        assert_eq!(keys(&inbox_links(&base())), ["ai-review", "shared"]);
    }

    #[test]
    fn supervisor_gets_supervision_last() {
        let links = inbox_links(&InboxInput {
            can_supervise: true,
            ..base()
        });
        assert_eq!(keys(&links), ["ai-review", "shared", "supervision"]);
    }

    #[test]
    fn local_account_gets_ai_only_even_when_supervising() {
        let links = inbox_links(&InboxInput {
            local: true,
            can_supervise: true,
            ..base()
        });
        assert_eq!(keys(&links), ["ai-review"]);
    }

    #[test]
    fn ai_badge_only_when_proposals_pending() {
        assert_eq!(inbox_links(&base())[0].badge, None);
        let links = inbox_links(&InboxInput {
            pending_proposals: 3,
            ..base()
        });
        assert_eq!(links[0].badge, Some(3));
        assert_eq!(links[1].badge, None);
    }

    #[test]
    fn no_attention_when_nothing_waits() {
        let input = AccountAttentionInput {
            conflicts: 0,
            inbox: vec![row("ai-review", None), row("shared", Some(0))],
            inbox_in_menu: false,
        };
        assert_eq!(
            account_attention(&input),
            AccountAttention {
                rows: vec![],
                total: 0
            }
        );
    }

    #[test]
    fn conflicts_and_waiting_rows_add_up() {
        let input = AccountAttentionInput {
            conflicts: 2,
            inbox: vec![row("ai-review", Some(3)), row("shared", None)],
            inbox_in_menu: false,
        };
        let out = account_attention(&input);
        assert_eq!(out.total, 5);
        assert_eq!(keys(&out.rows), ["sync-conflicts", "ai-review"]);
        assert_eq!(out.rows[0].badge, Some(2));
        assert_eq!(out.rows[0].path, "/settings#settings-sync");
    }

    #[test]
    fn waiting_rows_left_out_when_menu_lists_inbox() {
        let input = AccountAttentionInput {
            conflicts: 1,
            inbox: vec![row("ai-review", Some(4))],
            inbox_in_menu: true,
        };
        let out = account_attention(&input);
        assert_eq!(keys(&out.rows), ["sync-conflicts"]);
        assert_eq!(out.total, 5);
    }

    #[test]
    fn absent_badge_deserialises_as_none() {
        let row: InboxLink = serde_json::from_str(
            r#"{"key":"shared","label":"Shared","path":"/shared","icon":"share"}"#,
        )
        .expect("valid row");
        assert_eq!(row.badge, None);
    }
}
