//! Org membership row mapping (TS `membership-row.ts`). A row is an `org_memberships` row with
//! its embedded organisation, as PostgREST returns it.

use serde::{Deserialize, Serialize};

/// The embedded organisation of a membership row. PostgREST sends it as an object or as a
/// one-element array, depending on how it resolves the relationship.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(untagged)]
pub enum EmbeddedOrg {
    /// The organisation as one object.
    One(OrgName),
    /// The organisation as a list; the first entry is the one a membership names.
    Many(Vec<OrgName>),
}

/// The organisation's name, as the embedded relation selects it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct OrgName {
    /// The organisation's display name.
    pub name: String,
}

/// An `org_memberships` row as read with the `org_id, role, joined_via, organizations(name)` columns.
/// `joined_via` may be absent on rows written before it existed.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MembershipRow {
    /// The organisation's id.
    pub org_id: String,
    /// The member's role as stored.
    pub role: String,
    /// How the member joined, when recorded.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub joined_via: Option<String>,
    /// The organisation row, when embedded.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub organizations: Option<EmbeddedOrg>,
}

/// One membership as the app models it (TS `OrgMembershipView`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct OrgMembershipView {
    /// The organisation's id.
    pub org_id: String,
    /// The organisation's name, or `Lab` when the relation did not resolve.
    pub org_name: String,
    /// The member's role in the lab.
    pub role: String,
    /// How the member joined: `invite`, `create`, or `legacy` for rows from before it was kept.
    pub join_source: String,
}

/// The membership a row maps to (`membershipViewFromRow`). A missing or empty organisation
/// relation gives the name `Lab`; a `joined_via` other than `invite` or `create` is `legacy`.
#[must_use]
pub fn to_view(row: &MembershipRow) -> OrgMembershipView {
    let name = match &row.organizations {
        Some(EmbeddedOrg::One(org)) => Some(org.name.clone()),
        Some(EmbeddedOrg::Many(orgs)) => orgs.first().map(|org| org.name.clone()),
        None => None,
    };
    let join_source = row
        .joined_via
        .as_deref()
        .filter(|via| matches!(*via, "invite" | "create"))
        .unwrap_or("legacy");
    OrgMembershipView {
        org_id: row.org_id.clone(),
        org_name: name.unwrap_or_else(|| "Lab".to_owned()),
        role: row.role.clone(),
        join_source: join_source.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(joined_via: Option<&str>, organizations: Option<EmbeddedOrg>) -> MembershipRow {
        MembershipRow {
            org_id: "o1".into(),
            role: "phd".into(),
            joined_via: joined_via.map(String::from),
            organizations,
        }
    }

    fn org(name: &str) -> OrgName {
        OrgName { name: name.into() }
    }

    #[test]
    fn object_relation_gives_its_name() {
        let view = to_view(&row(
            Some("invite"),
            Some(EmbeddedOrg::One(org("Vale Lab"))),
        ));
        assert_eq!(view.org_name, "Vale Lab");
        assert_eq!(view.join_source, "invite");
    }

    #[test]
    fn array_relation_uses_first_entry() {
        let view = to_view(&row(
            Some("create"),
            Some(EmbeddedOrg::Many(vec![org("First"), org("Second")])),
        ));
        assert_eq!(view.org_name, "First");
        assert_eq!(view.join_source, "create");
    }

    #[test]
    fn empty_or_missing_relation_is_lab() {
        assert_eq!(to_view(&row(None, None)).org_name, "Lab");
        assert_eq!(
            to_view(&row(None, Some(EmbeddedOrg::Many(vec![])))).org_name,
            "Lab"
        );
    }

    #[test]
    fn other_join_values_are_legacy() {
        assert_eq!(to_view(&row(None, None)).join_source, "legacy");
        assert_eq!(to_view(&row(Some("backfill"), None)).join_source, "legacy");
    }
}
