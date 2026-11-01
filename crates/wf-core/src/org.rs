//! Lab invite codes: format, normalize, generate from bytes, and join rules.

/// Roles a lab invite code can grant, in the order codes are issued.
pub const ORG_INVITE_ROLES: [&str; 3] = ["professor", "phd", "masters"];

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
#[derive(Debug, Clone, PartialEq, Eq)]
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
