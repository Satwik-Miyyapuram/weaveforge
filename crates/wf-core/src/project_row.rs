//! Project row mapping (TS `project-rows.ts` `toDomain`). A row is a `projects` row as PostgREST
//! returns it; both backend providers read the same table, so the mapping lives here once.

use serde::{Deserialize, Serialize};

/// A `projects` row as read with the `id, name, color, created_at` columns.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ProjectRow {
    /// The project's id.
    pub id: String,
    /// The project's display name.
    pub name: String,
    /// The project's colour, when set.
    pub color: Option<String>,
    /// When the project was created, as the database writes it.
    pub created_at: String,
}

/// One project as the app models it (TS `Project`). An unset colour is left out of the output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Project {
    /// The project's id.
    pub id: String,
    /// The project's display name.
    pub name: String,
    /// The project's colour, when set.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub color: Option<String>,
    /// When the project was created.
    pub created_at: String,
}

/// The project a row maps to (`toDomain`). A `null` colour becomes an absent colour.
#[must_use]
pub fn to_project(row: &ProjectRow) -> Project {
    Project {
        id: row.id.clone(),
        name: row.name.clone(),
        color: row.color.clone(),
        created_at: row.created_at.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(color: Option<&str>) -> ProjectRow {
        ProjectRow {
            id: "p1".into(),
            name: "Thesis".into(),
            color: color.map(String::from),
            created_at: "2026-01-02T03:04:05Z".into(),
        }
    }

    #[test]
    fn maps_fields_and_keeps_colour() {
        let project = to_project(&row(Some("#ff0000")));
        assert_eq!(project.id, "p1");
        assert_eq!(project.name, "Thesis");
        assert_eq!(project.color.as_deref(), Some("#ff0000"));
        assert_eq!(project.created_at, "2026-01-02T03:04:05Z");
    }

    #[test]
    fn null_colour_is_absent_in_json() {
        let json = serde_json::to_value(to_project(&row(None))).expect("serialises");
        assert!(json.get("color").is_none());
        assert_eq!(json["createdAt"], "2026-01-02T03:04:05Z");
    }
}
