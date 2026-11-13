//! Lab member row mapping (TS `member-rows.ts`). A row is a `profiles` row as the member
//! queries read it. Both backend providers read the same table, so the mapping lives here once.

use serde::{Deserialize, Serialize};

/// A `profiles` row with the columns [`PROFILE_COLUMNS`] names. Nullable columns are `None`
/// when the row has no value.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ProfileRow {
    /// The member's user id.
    pub user_id: String,
    /// The member's email, when stored.
    pub email: Option<String>,
    /// The member's full name, when stored.
    pub full_name: Option<String>,
    /// The stored role (`professor`, `phd`, `masters` or `standalone`).
    pub role: String,
    /// The member's supervisor id, when set.
    pub supervisor_id: Option<String>,
    /// Whether first-run org setup finished, when stored.
    pub org_setup_complete: Option<bool>,
    /// The lab the member has active, when set.
    pub active_org_id: Option<String>,
}

/// A lab member as the app models it (TS `Member`). Unset optionals are left out of the
/// serialized object, as `undefined` is in JS.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Member {
    /// The member's user id.
    pub id: String,
    /// The member's email, when stored.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub email: Option<String>,
    /// The member's full name, when stored.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub full_name: Option<String>,
    /// The member's role.
    pub role: String,
    /// The member's supervisor id, when set.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub supervisor_id: Option<String>,
    /// Whether first-run org setup finished; a missing value counts as not finished.
    pub org_setup_complete: bool,
    /// The lab the member has active, when set.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub active_org_id: Option<String>,
}

/// The member a profile row maps to (`toDomain`).
#[must_use]
pub fn to_domain(row: &ProfileRow) -> Member {
    Member {
        id: row.user_id.clone(),
        email: row.email.clone(),
        full_name: row.full_name.clone(),
        role: row.role.clone(),
        supervisor_id: row.supervisor_id.clone(),
        org_setup_complete: row.org_setup_complete.unwrap_or(false),
        active_org_id: row.active_org_id.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row() -> ProfileRow {
        ProfileRow {
            user_id: "u1".into(),
            email: None,
            full_name: Some("Ada".into()),
            role: "phd".into(),
            supervisor_id: None,
            org_setup_complete: None,
            active_org_id: None,
        }
    }

    #[test]
    fn missing_setup_flag_is_not_complete() {
        assert!(!to_domain(&row()).org_setup_complete);
    }

    #[test]
    fn keeps_present_values() {
        let mut r = row();
        r.org_setup_complete = Some(true);
        r.supervisor_id = Some("u2".into());
        let m = to_domain(&r);
        assert!(m.org_setup_complete);
        assert_eq!(m.supervisor_id.as_deref(), Some("u2"));
        assert_eq!(m.full_name.as_deref(), Some("Ada"));
    }
}
