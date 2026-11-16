//! Which account entries the sidebar and the overflow menu show.
//!
//! The rules are the product: what the sidebar does *not* contain is as
//! deliberate as what it does. Two of these rules were bugs. The TypeScript
//! wrapper is `account-links.ts`.

use serde::{Deserialize, Serialize};

/// Documentation, reached from the account block and from the not-found page.
pub const DOCS_URL: &str = "https://www.weaveforge.org/docs/";

/// Which entry a row is. Serialized lowercase, matching the TypeScript union.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum AccountLinkId {
    /// Escape hatch to the project picker, shown only when no project is selected.
    Projects,
    /// Settings route.
    Settings,
    /// External documentation.
    Docs,
    /// Ends the session. Always last when shown.
    Signout,
    /// The way in, offered when this copy has no account.
    Signin,
}

/// Whether a project is selected and whether this copy has no account.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AccountLinksInput {
    /// Whether `ProjectSwitcher` is on screen. It hides itself when nothing is selected.
    pub has_project: bool,
    /// No account on this computer: there is no session to end, so the offer is sign in.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub local: bool,
}

/// One row of the account block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AccountLink {
    /// Which entry this is.
    pub id: AccountLinkId,
    /// Visible label.
    pub label: String,
    /// Destination. Absent for entries that run an action rather than navigate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String, optional))]
    pub href: Option<String>,
    /// External links open in a new tab.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = bool, optional))]
    pub external: Option<bool>,
}

fn link(id: AccountLinkId, label: &str) -> AccountLink {
    AccountLink {
        id,
        label: label.to_owned(),
        href: None,
        external: None,
    }
}

/// The account block's rows, in display order.
///
/// There is deliberately no GitHub entry: the source link stays on the public
/// pitch page, where someone looking for the source is. Documentation is here,
/// not inside Settings, because someone looking for it is usually already stuck.
/// Sharing and AI suggestions are not here either; they are the sidebar's Inbox
/// group (DA-85).
#[must_use]
pub fn account_links(input: &AccountLinksInput) -> Vec<AccountLink> {
    let mut links = Vec::with_capacity(4);
    // Only when the project switcher is not showing: with a project selected its
    // menu already offers "New / all projects".
    if !input.has_project {
        links.push(link(AccountLinkId::Projects, "Projects"));
    }
    links.push(AccountLink {
        id: AccountLinkId::Settings,
        label: "Settings".to_owned(),
        href: Some("/settings".to_owned()),
        external: None,
    });
    links.push(AccountLink {
        id: AccountLinkId::Docs,
        label: "Help & docs".to_owned(),
        href: Some(DOCS_URL.to_owned()),
        external: Some(true),
    });
    // Always last and always present: without an account the slot offers the way in.
    links.push(if input.local {
        link(AccountLinkId::Signin, "Sign in")
    } else {
        link(AccountLinkId::Signout, "Sign out")
    });
    links
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(input: AccountLinksInput) -> Vec<AccountLinkId> {
        account_links(&input).into_iter().map(|l| l.id).collect()
    }

    #[test]
    fn no_github_entry_in_any_state() {
        for (has_project, local) in [(true, false), (false, false), (true, true), (false, true)] {
            for l in account_links(&AccountLinksInput { has_project, local }) {
                assert!(!l.label.to_lowercase().contains("github"));
                assert!(!l.href.unwrap_or_default().contains("github.com"));
            }
        }
    }

    #[test]
    fn docs_is_external_and_always_present() {
        let docs = account_links(&AccountLinksInput {
            has_project: true,
            local: false,
        })
        .into_iter()
        .find(|l| l.id == AccountLinkId::Docs)
        .expect("docs present");
        assert_eq!(docs.href.as_deref(), Some(DOCS_URL));
        assert_eq!(docs.external, Some(true));
    }

    #[test]
    fn projects_only_when_no_project_selected() {
        assert!(
            !ids(AccountLinksInput {
                has_project: true,
                local: false
            })
            .contains(&AccountLinkId::Projects)
        );
        assert!(
            ids(AccountLinksInput {
                has_project: false,
                local: false
            })
            .contains(&AccountLinkId::Projects)
        );
    }

    #[test]
    fn sign_out_is_last_and_sign_in_replaces_it_locally() {
        for has_project in [true, false] {
            let list = ids(AccountLinksInput {
                has_project,
                local: false,
            });
            assert_eq!(list.last(), Some(&AccountLinkId::Signout));
        }
        let offline = ids(AccountLinksInput {
            has_project: true,
            local: true,
        });
        assert!(offline.contains(&AccountLinkId::Signin));
        assert!(!offline.contains(&AccountLinkId::Signout));
    }

    #[test]
    fn block_stays_short_and_ordinary_case_is_three() {
        assert!(
            account_links(&AccountLinksInput {
                has_project: false,
                local: false
            })
            .len()
                <= 4
        );
        assert_eq!(
            account_links(&AccountLinksInput {
                has_project: true,
                local: false
            })
            .len(),
            3
        );
    }

    #[test]
    fn actions_have_no_href_and_navigation_does() {
        for l in account_links(&AccountLinksInput {
            has_project: false,
            local: false,
        }) {
            match l.id {
                AccountLinkId::Projects | AccountLinkId::Signout | AccountLinkId::Signin => {
                    assert!(l.href.is_none(), "{:?} should act", l.id);
                }
                _ => assert!(l.href.is_some(), "{:?} has no href", l.id),
            }
        }
    }

    #[test]
    fn absent_local_defaults_to_false() {
        let input: AccountLinksInput =
            serde_json::from_str(r#"{"hasProject":true}"#).expect("parses");
        assert!(!input.local);
    }

    #[test]
    fn absent_href_and_external_are_omitted_on_output() {
        let json = serde_json::to_value(account_links(&AccountLinksInput {
            has_project: true,
            local: false,
        }))
        .expect("serializes");
        assert!(json[0].get("href").is_some());
        assert!(json[0].get("external").is_none());
    }
}
