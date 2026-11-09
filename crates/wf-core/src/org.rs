//! Lab invite codes: format, normalize, generate from bytes, join rules, and lab
//! membership and setup state.

use serde::{Deserialize, Serialize};

use crate::member::{self, ProfileState};

/// Roles a lab invite code can grant, in the order codes are issued.
pub const ORG_INVITE_ROLES: [&str; 3] = ["professor", "phd", "masters"];

/// An org membership as the lab rules read it. `join_source` is `invite`, `create`, or a
/// migration backfill value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Membership {
    #[serde(default)]
    pub org_id: String,
    pub join_source: Option<String>,
}

/// Whether the user created or joined the lab (not a migration backfill).
#[must_use]
pub fn is_explicit_lab_membership(m: &Membership) -> bool {
    matches!(m.join_source.as_deref(), Some("invite" | "create"))
}

/// Whether the active lab is set and the user is explicitly in it, or owns it.
#[must_use]
pub fn has_active_lab(
    active_org_id: Option<&str>,
    memberships: &[Membership],
    owns_active_org: bool,
) -> bool {
    let Some(active) = active_org_id.filter(|id| !id.is_empty()) else {
        return false;
    };
    if owns_active_org {
        return true;
    }
    memberships
        .iter()
        .any(|m| m.org_id == active && is_explicit_lab_membership(m))
}

/// Whether the standalone role sync may run. `labs` is `None` when the memberships could
/// not be read: unknown is not "no labs", and the sync clears `active_org_id`.
#[must_use]
pub fn should_sync_standalone(profile: Option<&ProfileState>, labs: Option<&[Membership]>) -> bool {
    let Some(labs) = labs else {
        return false;
    };
    let active = profile.and_then(|p| p.active_org_id.as_deref());
    let in_lab = has_active_lab(active, labs, false);
    member::needs_standalone_role_sync(profile, labs, in_lab)
}

/// The first-run setup state the setup gate reads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgSetupState {
    pub has_orgs: bool,
    pub loading: bool,
    pub profile: Option<ProfileState>,
    pub error: Option<String>,
}

/// Whether the first-run setup screen applies. A profile that failed to load is not a
/// missing profile: the screen would offer a lab member the choices that leave their lab.
#[must_use]
pub fn needs_org_setup(state: &OrgSetupState) -> bool {
    let failed = state.error.as_deref().is_some_and(|e| !e.is_empty());
    if !state.has_orgs || state.loading || failed {
        return false;
    }
    match &state.profile {
        None => true,
        Some(profile) => profile.org_setup_complete == Some(false),
    }
}

const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Keep ASCII letters and digits, uppercase them, and group by three with `-`.
#[must_use]
pub fn format_invite_code(raw: &str) -> String {
    let cleaned: Vec<char> = raw
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_uppercase())
        .collect();
    cleaned
        .chunks(3)
        .map(|group| group.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join("-")
}

/// Strip separators and whitespace, then map the usual typos (I/L to 1, O to 0).
#[must_use]
pub fn normalize_invite_code(input: &str) -> String {
    let stripped: String = input
        .chars()
        .filter(|c| *c != '-' && !c.is_whitespace())
        .collect();
    stripped
        .to_uppercase()
        .replace(['I', 'L'], "1")
        .replace('O', "0")
}

/// Turn 10 random bytes into a 9-character Crockford code, formatted as `XXX-XXX-XXX`.
#[must_use]
pub fn invite_code_from_bytes(bytes: &[u8; 10]) -> String {
    let mut value = bytes
        .iter()
        .fold(0u128, |acc, byte| (acc << 8) | u128::from(*byte));
    let mut raw = ['0'; 15];
    for i in 0..15 {
        let index = usize::try_from(value & 31).unwrap_or(0);
        raw[14 - i] = CROCKFORD.get(index).copied().map_or('0', char::from);
        value >>= 5;
    }
    format_invite_code(&raw[..9].iter().collect::<String>())
}

/// Trim a lab name. Empty names and names over 120 UTF-16 units are rejected.
pub fn validate_org_name(name: &str) -> Result<String, &'static str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Lab name is required.");
    }
    if trimmed.encode_utf16().count() > 120 {
        return Err("Lab name is too long.");
    }
    Ok(trimmed.to_owned())
}

/// The role and supervisor a joiner gets from an invite.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinAssignment {
    /// Profile role the joiner gets.
    pub role: String,
    /// Supervisor the joiner is linked to, if the role needs one.
    pub supervisor_id: Option<String>,
}

/// Pick the joiner's role and supervisor from the invite type and the lab's members.
pub fn resolve_join_assignment(
    target_role: &str,
    professor_ids: &[String],
    phd_ids: &[String],
    professor_supervisor_id: Option<&str>,
    phd_supervisor_id: Option<&str>,
) -> Result<JoinAssignment, &'static str> {
    match target_role {
        "professor" => Ok(JoinAssignment {
            role: "professor".to_owned(),
            supervisor_id: None,
        }),
        "phd" => {
            let candidate = if professor_ids.len() == 1 {
                professor_ids.first().map(String::as_str)
            } else {
                professor_supervisor_id
            };
            let prof = listed(candidate, professor_ids)
                .ok_or("Choose a professor supervisor for this lab.")?;
            Ok(JoinAssignment {
                role: "phd".to_owned(),
                supervisor_id: Some(prof.to_owned()),
            })
        }
        "masters" => {
            let phd =
                listed(phd_supervisor_id, phd_ids).ok_or("Choose a PhD supervisor in this lab.")?;
            Ok(JoinAssignment {
                role: "masters".to_owned(),
                supervisor_id: Some(phd.to_owned()),
            })
        }
        _ => Err("Unknown invite type."),
    }
}

/// The candidate id, if it is non-empty and appears in the list.
fn listed<'a>(candidate: Option<&'a str>, ids: &[String]) -> Option<&'a str> {
    candidate.filter(|id| !id.is_empty() && ids.iter().any(|known| known == id))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod membership_tests {
    use super::*;

    fn membership(org: &str, source: Option<&str>) -> Membership {
        Membership {
            org_id: org.to_owned(),
            join_source: source.map(str::to_owned),
        }
    }

    fn profile(setup: Option<bool>) -> ProfileState {
        ProfileState {
            role: "masters".to_owned(),
            org_setup_complete: setup,
            active_org_id: None,
        }
    }

    #[test]
    fn only_invite_and_create_are_explicit() {
        assert!(is_explicit_lab_membership(&membership("a", Some("invite"))));
        assert!(is_explicit_lab_membership(&membership("a", Some("create"))));
        assert!(!is_explicit_lab_membership(&membership(
            "a",
            Some("backfill")
        )));
        assert!(!is_explicit_lab_membership(&membership("a", None)));
    }

    #[test]
    fn active_lab_needs_an_explicit_membership_or_ownership() {
        let memberships = [
            membership("a", Some("invite")),
            membership("b", Some("backfill")),
        ];
        assert!(has_active_lab(Some("a"), &memberships, false));
        assert!(!has_active_lab(Some("b"), &memberships, false));
        assert!(!has_active_lab(Some("c"), &memberships, false));
        assert!(!has_active_lab(None, &memberships, true));
        assert!(!has_active_lab(Some(""), &memberships, true));
        assert!(has_active_lab(Some("b"), &memberships, true));
    }

    #[test]
    fn sync_skipped_when_memberships_unknown() {
        let stale = profile(Some(true));
        assert!(!should_sync_standalone(Some(&stale), None));
        assert!(should_sync_standalone(Some(&stale), Some(&[])));
        assert!(!should_sync_standalone(
            Some(&stale),
            Some(&[membership("a", Some("invite"))])
        ));
    }

    #[test]
    fn sync_skipped_when_the_active_lab_is_real() {
        let mut active = profile(Some(true));
        active.active_org_id = Some("a".to_owned());
        assert!(!should_sync_standalone(
            Some(&active),
            Some(&[membership("a", Some("invite"))])
        ));
        assert!(should_sync_standalone(
            Some(&active),
            Some(&[membership("a", Some("backfill"))])
        ));
    }

    #[test]
    fn setup_screen_shows_for_missing_or_unfinished_profiles_only() {
        let ready = OrgSetupState {
            has_orgs: true,
            loading: false,
            profile: None,
            error: None,
        };
        assert!(needs_org_setup(&ready));
        let unfinished = OrgSetupState {
            profile: Some(profile(Some(false))),
            ..ready.clone()
        };
        assert!(needs_org_setup(&unfinished));
        let done = OrgSetupState {
            profile: Some(profile(Some(true))),
            ..ready.clone()
        };
        assert!(!needs_org_setup(&done));
        let failed = OrgSetupState {
            error: Some("Network down".to_owned()),
            ..ready.clone()
        };
        assert!(!needs_org_setup(&failed));
        let loading = OrgSetupState {
            loading: true,
            ..ready.clone()
        };
        assert!(!needs_org_setup(&loading));
        let no_orgs = OrgSetupState {
            has_orgs: false,
            ..ready
        };
        assert!(!needs_org_setup(&no_orgs));
    }
}
