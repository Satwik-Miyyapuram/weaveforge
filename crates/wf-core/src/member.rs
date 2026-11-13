//! Lab member rules: role ranks, new-member validation, email masking, and confirmation-code parsing.

use std::collections::{HashMap, HashSet, VecDeque};

use serde::{Deserialize, Serialize};

use crate::org::{Membership, ORG_INVITE_ROLES, is_explicit_lab_membership};

/// Rank of a role for creation rules. Higher ranks can create lower ones; `None` is unknown.
#[must_use]
pub fn role_rank(role: &str) -> Option<i8> {
    match role {
        "standalone" => Some(-1),
        "masters" => Some(0),
        "phd" => Some(1),
        "professor" => Some(2),
        _ => None,
    }
}

/// Whether a member with `creator` role may create an account with `target` role.
#[must_use]
pub fn can_create_role(creator: &str, target: &str) -> bool {
    let Some(creator_rank) = role_rank(creator) else {
        return false;
    };
    let Some(target_rank) = role_rank(target) else {
        return false;
    };
    ORG_INVITE_ROLES.contains(&target) && target_rank < creator_rank
}

/// A validated account request for a new lab member.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct NewMember {
    /// Lowercased, trimmed email.
    pub email: String,
    /// Password exactly as entered.
    pub password: String,
    /// Trimmed full name, if any.
    pub full_name: Option<String>,
    /// Invite role the member is created with.
    pub role: String,
    /// Trimmed supervisor id, if any.
    pub supervisor_id: Option<String>,
}

/// Validate and normalize the fields for creating a lab member.
pub fn validate_new_member(
    email: &str,
    password: &str,
    full_name: Option<&str>,
    role: &str,
    supervisor_id: Option<&str>,
) -> Result<NewMember, String> {
    let email = js_trim(email).to_lowercase();
    if email.is_empty() {
        return Err("Email is required.".to_owned());
    }
    if password.encode_utf16().count() < 8 {
        return Err("Password must be at least 8 characters.".to_owned());
    }
    if !ORG_INVITE_ROLES.contains(&role) {
        return Err(format!("Unknown role: {role}"));
    }
    Ok(NewMember {
        email,
        password: password.to_owned(),
        full_name: non_empty(full_name),
        role: role.to_owned(),
        supervisor_id: non_empty(supervisor_id),
    })
}

/// Trim with JS `String.prototype.trim` semantics, which also strip the BOM.
fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// Trim an optional value and drop it when empty.
fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(js_trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// Keep the first two characters of the local part and the domain, e.g. `ja***@example.com`.
#[must_use]
pub fn mask_email(email: &str) -> String {
    let mut parts = email.split('@');
    let local = parts.next().unwrap_or("");
    let domain = parts.next().unwrap_or("");
    if local.is_empty() || domain.is_empty() {
        return email.to_owned();
    }
    let visible: String = local.chars().take(2).collect();
    format!("{visible}***@{domain}")
}

/// A confirmation code typed by the user, or a token hash from a confirmation link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OtpInput {
    /// Six to eight digit email code.
    Token(String),
    /// Hashed token from a confirmation link.
    TokenHash(String),
}

/// Parse a pasted code or confirmation link. Returns `None` when neither form matches.
#[must_use]
pub fn parse_otp_or_link(raw: &str) -> Option<OtpInput> {
    let t = js_trim(raw);
    if is_code(t) {
        return Some(OtpInput::Token(t.to_owned()));
    }
    if let Ok(url) = url::Url::parse(t) {
        let pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
        if let Some(found) = pick(&pairs) {
            return Some(found);
        }
    } else if t.contains("token=") || t.contains("token_hash=") {
        let query = t.split_once('?').map_or(t, |(_, q)| q);
        let pairs: Vec<(String, String)> = url::form_urlencoded::parse(query.as_bytes())
            .into_owned()
            .collect();
        if let Some(found) = pick(&pairs) {
            return Some(found);
        }
    }
    if is_hash(t) {
        return Some(OtpInput::TokenHash(t.to_owned()));
    }
    None
}

/// Pick `token_hash` first, then `token`, ignoring empty values.
fn pick(pairs: &[(String, String)]) -> Option<OtpInput> {
    let value = |key: &str| {
        pairs
            .iter()
            .find(|(k, v)| k == key && !v.is_empty())
            .map(|(_, v)| v.clone())
    };
    if let Some(hash) = value("token_hash") {
        return Some(OtpInput::TokenHash(hash));
    }
    let token = value("token")?;
    if is_code(&token) {
        Some(OtpInput::Token(token))
    } else {
        Some(OtpInput::TokenHash(token))
    }
}

/// Six to eight ASCII digits.
fn is_code(s: &str) -> bool {
    (6..=8).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit())
}

/// At least 16 characters from `[A-Za-z0-9_.-]`.
fn is_hash(s: &str) -> bool {
    s.len() >= 16
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.' || b == b'-')
}

/// Roles `creator` may create accounts for, in invite-code order.
#[must_use]
pub fn creatable_roles(creator: &str) -> Vec<&'static str> {
    let Some(rank) = role_rank(creator) else {
        return Vec::new();
    };
    ORG_INVITE_ROLES
        .into_iter()
        .filter(|role| role_rank(role).is_some_and(|r| r < rank))
        .collect()
}

/// A lab member as the visibility rules see them: an id and the supervisor's id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MemberLink {
    /// The member's user id.
    pub id: String,
    /// The supervisor's user id, when the member has one.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub supervisor_id: Option<String>,
}

/// A member as the name map reads them (TS `Member`, the fields it uses).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MemberNameSource {
    /// The member's user id.
    pub id: String,
    /// The member's full name, when set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub full_name: Option<String>,
    /// The member's email, when set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub email: Option<String>,
}

/// A member id and the name shown for them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MemberName {
    /// The member's user id.
    pub id: String,
    /// Full name, else email, else `"Member"`.
    pub name: String,
}

/// The name shown for each member: full name, else email, else `"Member"`.
#[must_use]
pub fn member_name_map(members: &[MemberNameSource]) -> Vec<MemberName> {
    members
        .iter()
        .map(|m| MemberName {
            id: m.id.clone(),
            name: m
                .full_name
                .clone()
                .or_else(|| m.email.clone())
                .unwrap_or_else(|| "Member".to_owned()),
        })
        .collect()
}

/// Ids the viewer can see: the viewer and everyone below them, at any depth.
#[must_use]
pub fn accessible_member_ids(viewer_id: &str, members: &[MemberLink]) -> HashSet<String> {
    let mut children_of: HashMap<&str, Vec<&str>> = HashMap::new();
    for m in members {
        if let Some(supervisor) = m.supervisor_id.as_deref().filter(|s| !s.is_empty()) {
            children_of
                .entry(supervisor)
                .or_default()
                .push(m.id.as_str());
        }
    }
    let mut ids = HashSet::from([viewer_id.to_owned()]);
    let mut queue = VecDeque::from([viewer_id]);
    while let Some(current) = queue.pop_front() {
        for &child in children_of.get(&current).into_iter().flatten() {
            if ids.insert(child.to_owned()) {
                queue.push_back(child);
            }
        }
    }
    ids
}

/// What the viewer may see of a lab. `org_member_ids` is the active lab's roster, when known.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamVisibility {
    /// Whether the viewer is in a lab.
    pub in_lab: bool,
    /// The active lab's member ids, when known.
    pub org_member_ids: Option<HashSet<String>>,
}

/// Indices of the active-lab roster. Falls back to the viewer alone when the roster is
/// empty or unknown (fails closed).
fn scoped_lab_pool(
    viewer_id: &str,
    members: &[MemberLink],
    options: &TeamVisibility,
) -> Vec<usize> {
    let lab = if options.in_lab {
        options.org_member_ids.as_ref()
    } else {
        None
    };
    if let Some(lab) = lab.filter(|lab| !lab.is_empty()) {
        return members
            .iter()
            .enumerate()
            .filter(|(_, m)| lab.contains(&m.id))
            .map(|(i, _)| i)
            .collect();
    }
    members
        .iter()
        .position(|m| m.id == viewer_id)
        .into_iter()
        .collect()
}

/// Indices of the supervision team: the viewer plus all supervisees, at any depth. A
/// viewer outside a lab sees only themselves.
#[must_use]
pub fn filter_team_members(
    viewer_id: &str,
    members: &[MemberLink],
    options: &TeamVisibility,
) -> Vec<usize> {
    let pool = scoped_lab_pool(viewer_id, members, options);
    if !options.in_lab {
        return pool;
    }
    let pool_links: Vec<MemberLink> = pool.iter().map(|&i| members[i].clone()).collect();
    let allowed = accessible_member_ids(viewer_id, &pool_links);
    let mut seen = HashSet::new();
    pool.into_iter()
        .filter(|&i| allowed.contains(&members[i].id) && seen.insert(members[i].id.as_str()))
        .collect()
}

/// Indices of the full active-lab roster for the org chart, supervisors and peers included.
#[must_use]
pub fn filter_lab_members(
    viewer_id: &str,
    members: &[MemberLink],
    options: &TeamVisibility,
) -> Vec<usize> {
    scoped_lab_pool(viewer_id, members, options)
}

/// Indices of the people below `viewer_id` in the supervisor tree, at any depth.
#[must_use]
pub fn students_of(viewer_id: Option<&str>, team: &[MemberLink]) -> Vec<usize> {
    let Some(viewer_id) = viewer_id.filter(|v| !v.is_empty()) else {
        return Vec::new();
    };
    let below = accessible_member_ids(viewer_id, team);
    team.iter()
        .enumerate()
        .filter(|(_, m)| m.id != viewer_id && below.contains(&m.id))
        .map(|(i, _)| i)
        .collect()
}

/// Whether a role can supervise others (rank above masters).
#[must_use]
pub fn is_supervisor_role(role: Option<&str>) -> bool {
    role.and_then(role_rank).is_some_and(|rank| rank > 0)
}

/// Role shown for a member. Outside a lab everyone is standalone, except a professor whose
/// viewer owns the lab.
#[must_use]
pub fn resolve_display_role(role: &str, in_lab: bool, owns_org: bool) -> &str {
    if in_lab {
        return role;
    }
    if owns_org && role == "professor" {
        return "professor";
    }
    "standalone"
}

/// The profile fields the standalone role sync reads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ProfileState {
    /// The stored `profiles.role`.
    pub role: String,
    /// Whether first-run org setup finished.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub org_setup_complete: Option<bool>,
    /// The lab the profile has active, if any.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub active_org_id: Option<String>,
}

/// Whether `profiles.role` should be saved as standalone: the stored lab role is stale.
#[must_use]
pub fn needs_standalone_role_sync(
    profile: Option<&ProfileState>,
    memberships: &[Membership],
    in_lab: bool,
) -> bool {
    let Some(profile) = profile else {
        return false;
    };
    if profile.org_setup_complete == Some(false) || in_lab || profile.role == "standalone" {
        return false;
    }
    let owns_org = memberships
        .iter()
        .any(|m| m.join_source.as_deref() == Some("create"));
    if owns_org && profile.role == "professor" {
        return false;
    }
    !memberships.iter().any(is_explicit_lab_membership)
}

/// Supervisor recorded for an account the `creator_id` member creates: the creator.
#[must_use]
pub fn resolve_supervisor_id(creator_id: &str) -> String {
    creator_id.to_owned()
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    #[test]
    fn resolve_supervisor_id_is_creator() {
        assert_eq!(resolve_supervisor_id("prof"), "prof");
    }

    fn link(id: &str, supervisor: Option<&str>) -> MemberLink {
        MemberLink {
            id: id.to_owned(),
            supervisor_id: supervisor.map(str::to_owned),
        }
    }

    fn ids(members: &[MemberLink], idx: &[usize]) -> Vec<String> {
        idx.iter().map(|&i| members[i].id.clone()).collect()
    }

    fn lab_team() -> Vec<MemberLink> {
        vec![
            link("prof", None),
            link("phd", Some("prof")),
            link("ms", Some("phd")),
            link("ms2", Some("prof")),
            link("peer", None),
        ]
    }

    fn in_lab(roster: &[&str]) -> TeamVisibility {
        TeamVisibility {
            in_lab: true,
            org_member_ids: Some(roster.iter().map(|s| (*s).to_owned()).collect()),
        }
    }

    #[test]
    fn creatable_roles_only_lower_ranks() {
        assert_eq!(creatable_roles("professor"), ["phd", "masters"]);
        assert_eq!(creatable_roles("phd"), ["masters"]);
        assert!(creatable_roles("masters").is_empty());
        assert!(creatable_roles("standalone").is_empty());
        assert!(creatable_roles("nope").is_empty());
    }

    #[test]
    fn accessible_ids_are_the_whole_subtree() {
        let team = lab_team();
        let prof = accessible_member_ids("prof", &team);
        assert_eq!(prof.len(), 4);
        assert!(!prof.contains("peer"));
        let phd = accessible_member_ids("phd", &team);
        assert_eq!(phd, HashSet::from(["phd".to_owned(), "ms".to_owned()]));
    }

    #[test]
    fn empty_supervisor_id_is_not_a_parent() {
        let team = vec![link("a", Some("")), link("b", Some("a"))];
        assert_eq!(accessible_member_ids("a", &team).len(), 2);
    }

    #[test]
    fn team_outside_a_lab_is_the_viewer_only() {
        let team = lab_team();
        let solo = filter_team_members("ms2", &team, &TeamVisibility::default());
        assert_eq!(ids(&team, &solo), ["ms2"]);
    }

    #[test]
    fn team_in_lab_is_scoped_to_the_roster() {
        let team = lab_team();
        let options = in_lab(&["prof", "phd", "ms", "ms2"]);
        assert_eq!(
            ids(&team, &filter_team_members("prof", &team, &options)),
            ["prof", "phd", "ms", "ms2"]
        );
        assert_eq!(
            ids(&team, &filter_team_members("phd", &team, &options)),
            ["phd", "ms"]
        );
    }

    #[test]
    fn empty_or_unknown_roster_fails_closed_to_the_viewer() {
        let team = lab_team();
        let no_roster = TeamVisibility {
            in_lab: true,
            org_member_ids: None,
        };
        assert_eq!(
            ids(&team, &filter_team_members("prof", &team, &no_roster)),
            ["prof"]
        );
        assert_eq!(
            ids(&team, &filter_lab_members("prof", &team, &in_lab(&[]))),
            ["prof"]
        );
    }

    #[test]
    fn lab_roster_includes_supervisors_and_peers() {
        let team = lab_team();
        let options = in_lab(&["prof", "phd", "peer"]);
        assert_eq!(
            ids(&team, &filter_lab_members("phd", &team, &options)),
            ["prof", "phd", "peer"]
        );
    }

    #[test]
    fn students_are_below_the_viewer_only() {
        let team = lab_team();
        assert_eq!(ids(&team, &students_of(Some("phd"), &team)), ["ms"]);
        assert_eq!(
            ids(&team, &students_of(Some("prof"), &team)),
            ["phd", "ms", "ms2"]
        );
        assert!(students_of(Some("ms"), &team).is_empty());
        assert!(students_of(None, &team).is_empty());
        assert!(students_of(Some(""), &team).is_empty());
    }

    #[test]
    fn supervisors_are_above_masters() {
        assert!(is_supervisor_role(Some("professor")));
        assert!(is_supervisor_role(Some("phd")));
        assert!(!is_supervisor_role(Some("masters")));
        assert!(!is_supervisor_role(Some("standalone")));
        assert!(!is_supervisor_role(None));
    }

    #[test]
    fn display_role_is_standalone_outside_a_lab() {
        assert_eq!(resolve_display_role("masters", false, false), "standalone");
        assert_eq!(resolve_display_role("masters", true, false), "masters");
        assert_eq!(resolve_display_role("professor", false, true), "professor");
        assert_eq!(resolve_display_role("phd", false, true), "standalone");
    }

    fn profile(role: &str, setup: Option<bool>) -> ProfileState {
        ProfileState {
            role: role.to_owned(),
            org_setup_complete: setup,
            active_org_id: None,
        }
    }

    fn membership(source: Option<&str>) -> Membership {
        Membership {
            org_id: "org".to_owned(),
            join_source: source.map(str::to_owned),
        }
    }

    #[test]
    fn stale_lab_role_needs_standalone_sync() {
        let masters = profile("masters", Some(true));
        assert!(needs_standalone_role_sync(Some(&masters), &[], false));
        assert!(needs_standalone_role_sync(
            Some(&masters),
            &[membership(Some("backfill"))],
            false
        ));
        assert!(!needs_standalone_role_sync(
            Some(&masters),
            &[membership(Some("invite"))],
            false
        ));
        assert!(!needs_standalone_role_sync(Some(&masters), &[], true));
    }

    #[test]
    fn owner_professor_and_unset_setup_skip_the_sync() {
        let prof = profile("professor", Some(true));
        assert!(!needs_standalone_role_sync(
            Some(&prof),
            &[membership(Some("create"))],
            false
        ));
        assert!(needs_standalone_role_sync(Some(&prof), &[], false));
        assert!(!needs_standalone_role_sync(
            Some(&profile("masters", Some(false))),
            &[],
            false
        ));
        assert!(!needs_standalone_role_sync(None, &[], false));
        assert!(!needs_standalone_role_sync(
            Some(&profile("standalone", None)),
            &[],
            false
        ));
    }

    #[test]
    fn rank_orders_roles() {
        assert_eq!(role_rank("standalone"), Some(-1));
        assert_eq!(role_rank("masters"), Some(0));
        assert_eq!(role_rank("phd"), Some(1));
        assert_eq!(role_rank("professor"), Some(2));
        assert_eq!(role_rank("admin"), None);
    }

    #[test]
    fn professor_creates_phd_and_masters_only() {
        assert!(can_create_role("professor", "phd"));
        assert!(can_create_role("professor", "masters"));
        assert!(!can_create_role("professor", "professor"));
    }

    #[test]
    fn phd_creates_masters_only() {
        assert!(can_create_role("phd", "masters"));
        assert!(!can_create_role("phd", "phd"));
        assert!(!can_create_role("phd", "professor"));
    }

    #[test]
    fn masters_standalone_and_unknown_create_nothing() {
        assert!(!can_create_role("masters", "masters"));
        assert!(!can_create_role("standalone", "masters"));
        assert!(!can_create_role("unknown", "masters"));
    }

    #[test]
    fn unknown_target_is_never_creatable() {
        assert!(!can_create_role("professor", "admin"));
        assert!(!can_create_role("professor", "standalone"));
    }

    #[test]
    fn validate_trims_and_lowercases_email() {
        let member = validate_new_member(
            "  Foo@Lab.EDU ",
            "password1",
            Some(" Ann "),
            "phd",
            Some(" p1 "),
        )
        .unwrap();
        assert_eq!(member.email, "foo@lab.edu");
        assert_eq!(member.password, "password1");
        assert_eq!(member.full_name.as_deref(), Some("Ann"));
        assert_eq!(member.role, "phd");
        assert_eq!(member.supervisor_id.as_deref(), Some("p1"));
    }

    #[test]
    fn validate_rejects_blank_email() {
        let err = validate_new_member("  ", "password1", None, "phd", None).unwrap_err();
        assert_eq!(err, "Email is required.");
    }

    #[test]
    fn validate_rejects_short_password_by_utf16_units() {
        let err = validate_new_member("a@b.c", "1234567", None, "phd", None).unwrap_err();
        assert_eq!(err, "Password must be at least 8 characters.");
        let accented = "ééééééé";
        assert_eq!(accented.chars().count(), 7);
        let err = validate_new_member("a@b.c", accented, None, "phd", None).unwrap_err();
        assert_eq!(err, "Password must be at least 8 characters.");
    }

    #[test]
    fn validate_rejects_unknown_role() {
        let err = validate_new_member("a@b.c", "password1", None, "admin", None).unwrap_err();
        assert_eq!(err, "Unknown role: admin");
    }

    #[test]
    fn validate_turns_blank_optionals_into_none() {
        let member =
            validate_new_member("a@b.c", "password1", Some("   "), "masters", Some("")).unwrap();
        assert_eq!(member.full_name, None);
        assert_eq!(member.supervisor_id, None);
        assert_eq!(member.password, "password1");
    }

    #[test]
    fn mask_keeps_two_local_chars() {
        assert_eq!(mask_email("ja@example.com"), "ja***@example.com");
        assert_eq!(mask_email("a@b.c"), "a***@b.c");
    }

    #[test]
    fn mask_leaves_malformed_email_unchanged() {
        assert_eq!(mask_email("nodomain"), "nodomain");
        assert_eq!(mask_email("x@"), "x@");
        assert_eq!(mask_email("@x.com"), "@x.com");
        assert_eq!(mask_email("a@b@c"), "a***@b");
    }

    #[test]
    fn otp_accepts_six_to_eight_digits() {
        assert_eq!(
            parse_otp_or_link("123456"),
            Some(OtpInput::Token("123456".to_owned()))
        );
        assert_eq!(
            parse_otp_or_link(" 12345678 "),
            Some(OtpInput::Token("12345678".to_owned()))
        );
        assert_eq!(parse_otp_or_link("12345"), None);
    }

    #[test]
    fn otp_reads_token_hash_from_link() {
        assert_eq!(
            parse_otp_or_link("https://x.test/confirm?token_hash=abcdef123&type=email"),
            Some(OtpInput::TokenHash("abcdef123".to_owned()))
        );
    }

    #[test]
    fn otp_reads_token_from_link() {
        assert_eq!(
            parse_otp_or_link("https://x.test/?token=123456"),
            Some(OtpInput::Token("123456".to_owned()))
        );
        assert_eq!(
            parse_otp_or_link("https://x.test/?token=abcdefgh"),
            Some(OtpInput::TokenHash("abcdefgh".to_owned()))
        );
    }

    #[test]
    fn otp_reads_bare_query_string() {
        assert_eq!(
            parse_otp_or_link("token_hash=abcdef"),
            Some(OtpInput::TokenHash("abcdef".to_owned()))
        );
    }

    #[test]
    fn otp_rejects_url_without_token() {
        assert_eq!(parse_otp_or_link("https://x/?a=1"), None);
    }

    #[test]
    fn otp_accepts_long_bare_hash() {
        assert_eq!(
            parse_otp_or_link("abcDEF_123-456.7890x"),
            Some(OtpInput::TokenHash("abcDEF_123-456.7890x".to_owned()))
        );
    }

    #[test]
    fn otp_rejects_short_junk() {
        assert_eq!(parse_otp_or_link("short!"), None);
    }
}

/// The member field the role label reads (TS `Member.role`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct MemberRole {
    /// The stored role.
    pub role: String,
}

/// Display label for a role (TS `ROLE_LABELS`); `None` for a role with no label.
#[must_use]
pub fn role_label(role: &str) -> Option<&'static str> {
    match role {
        "professor" => Some("Professor"),
        "phd" => Some("PhD supervisor"),
        "masters" => Some("Master's student"),
        "standalone" => Some("Standalone"),
        _ => None,
    }
}

/// Label shown for a member (TS `memberRoleLabel`): `None` when the display role has no label.
#[must_use]
pub fn member_role_label(
    member: &MemberRole,
    in_lab: bool,
    owns_org: bool,
) -> Option<&'static str> {
    role_label(resolve_display_role(&member.role, in_lab, owns_org))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod role_label_tests {
    use super::*;

    fn role(r: &str) -> MemberRole {
        MemberRole { role: r.to_owned() }
    }

    #[test]
    fn labels_match_ts_role_labels() {
        assert_eq!(role_label("professor"), Some("Professor"));
        assert_eq!(role_label("phd"), Some("PhD supervisor"));
        assert_eq!(role_label("masters"), Some("Master's student"));
        assert_eq!(role_label("standalone"), Some("Standalone"));
        assert_eq!(role_label("admin"), None);
    }

    #[test]
    fn outside_a_lab_everyone_is_standalone_except_owner_professor() {
        assert_eq!(
            member_role_label(&role("masters"), false, false),
            Some("Standalone")
        );
        assert_eq!(
            member_role_label(&role("professor"), false, true),
            Some("Professor")
        );
        assert_eq!(
            member_role_label(&role("phd"), false, true),
            Some("Standalone")
        );
    }

    #[test]
    fn in_a_lab_the_stored_role_shows() {
        assert_eq!(
            member_role_label(&role("masters"), true, false),
            Some("Master's student")
        );
        assert_eq!(
            member_role_label(&role("phd"), true, true),
            Some("PhD supervisor")
        );
    }

    #[test]
    fn unknown_role_has_no_label_in_a_lab() {
        assert_eq!(member_role_label(&role("admin"), true, false), None);
    }
}
