//! Library pin row mapping (TS `library-pin-rows.ts`). A `library_pins` row is read as snake_case
//! columns. Both backend providers read the same table, so the mapping lives here once.

use serde::{Deserialize, Serialize};

use crate::sharing::ShareableType;

/// A `library_pins` row with the columns the pin queries name.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PinRow {
    /// The pin's id.
    pub id: String,
    /// The user the pin belongs to.
    pub user_id: String,
    /// The project the pin is in.
    pub project_id: String,
    /// The kind of shared resource pinned.
    pub resource_type: ShareableType,
    /// The pinned resource's id.
    pub resource_id: String,
    /// The owner of the pinned resource.
    pub owner_id: String,
    /// When the pin was created, as stored.
    pub created_at: String,
}

/// A library pin as the app models it (TS `LibraryPin`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LibraryPin {
    /// The pin's id.
    pub id: String,
    /// The user the pin belongs to.
    pub user_id: String,
    /// The project the pin is in.
    pub project_id: String,
    /// The kind of shared resource pinned.
    pub resource_type: ShareableType,
    /// The pinned resource's id.
    pub resource_id: String,
    /// The owner of the pinned resource.
    pub owner_id: String,
    /// When the pin was created, as stored.
    pub created_at: String,
}

/// A pin row as the domain pin. Every column copies across unchanged.
#[must_use]
pub fn to_domain(row: &PinRow) -> LibraryPin {
    LibraryPin {
        id: row.id.clone(),
        user_id: row.user_id.clone(),
        project_id: row.project_id.clone(),
        resource_type: row.resource_type,
        resource_id: row.resource_id.clone(),
        owner_id: row.owner_id.clone(),
        created_at: row.created_at.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_snake_case_row_to_camel_case_pin() {
        let row: PinRow = serde_json::from_str(
            r#"{"id":"p1","user_id":"u1","project_id":"j1","resource_type":"report_section",
                "resource_id":"r1","owner_id":"o1","created_at":"2026-11-01T00:00:00Z"}"#,
        )
        .expect("row parses");
        let pin = to_domain(&row);
        assert_eq!(pin.user_id, "u1");
        assert_eq!(pin.resource_type, ShareableType::ReportSection);
        let json = serde_json::to_value(&pin).expect("pin serialises");
        assert_eq!(json["projectId"], "j1");
        assert_eq!(json["createdAt"], "2026-11-01T00:00:00Z");
    }
}
