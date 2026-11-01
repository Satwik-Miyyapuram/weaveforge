//! Lab member rules: role ranks, new-member validation, email masking, and confirmation-code parsing.

use crate::org::ORG_INVITE_ROLES;

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
#[derive(Debug, Clone, PartialEq, Eq)]
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

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

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
