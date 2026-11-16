//! Reading-list row mapping (TS `reading-list-rows.ts`). A row is the table's columns as the
//! database names them; the domain types are camelCase. Every backend reads and writes the same
//! table, so the mapping lives here once.

use serde::{Deserialize, Serialize};

use super::reading_list::{ReadingList, ReadingListItem};

/// A `reading_lists` row as stored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[allow(missing_docs)]
pub struct ReadingListRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub parent_id: Option<String>,
    pub sort_order: f64,
    pub color: Option<String>,
    pub created_at: String,
}

/// A `reading_list_items` row as stored. The two inherited/duplicate columns are left out of
/// the written row when unset, so an upsert does not overwrite them with null.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[allow(missing_docs)]
pub struct ReadingListItemRow {
    pub id: String,
    pub list_id: String,
    pub paper_id: Option<String>,
    pub vault_page_id: Option<String>,
    pub sort_order: f64,
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub inherited_from_list_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub duplicate_of_item_id: Option<String>,
}

/// The domain list for a stored row (`toListDomain`).
#[must_use]
pub fn to_list_domain(row: &ReadingListRow) -> ReadingList {
    ReadingList {
        id: row.id.clone(),
        name: row.name.clone(),
        description: row.description.clone(),
        parent_id: row.parent_id.clone(),
        sort_order: row.sort_order,
        color: row.color.clone(),
        created_at: row.created_at.clone(),
    }
}

/// The row a list is written as (`toListRow`).
#[must_use]
pub fn to_list_row(list: &ReadingList) -> ReadingListRow {
    ReadingListRow {
        id: list.id.clone(),
        name: list.name.clone(),
        description: list.description.clone(),
        parent_id: list.parent_id.clone(),
        sort_order: list.sort_order,
        color: list.color.clone(),
        created_at: list.created_at.clone(),
    }
}

/// The domain item for a stored row (`toItemDomain`).
#[must_use]
pub fn to_item_domain(row: &ReadingListItemRow) -> ReadingListItem {
    ReadingListItem {
        id: row.id.clone(),
        list_id: row.list_id.clone(),
        paper_id: row.paper_id.clone(),
        vault_page_id: row.vault_page_id.clone(),
        sort_order: row.sort_order,
        note: row.note.clone(),
        inherited_from_list_id: row.inherited_from_list_id.clone(),
        duplicate_of_item_id: row.duplicate_of_item_id.clone(),
    }
}

/// The row an item is written as (`toItemRow`). An empty inherited or duplicate id is treated
/// as unset and left out.
#[must_use]
pub fn to_item_row(item: &ReadingListItem) -> ReadingListItemRow {
    ReadingListItemRow {
        id: item.id.clone(),
        list_id: item.list_id.clone(),
        paper_id: item.paper_id.clone(),
        vault_page_id: item.vault_page_id.clone(),
        sort_order: item.sort_order,
        note: item.note.clone(),
        inherited_from_list_id: non_empty(&item.inherited_from_list_id),
        duplicate_of_item_id: non_empty(&item.duplicate_of_item_id),
    }
}

fn non_empty(id: &Option<String>) -> Option<String> {
    id.clone().filter(|id| !id.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(inherited: Option<&str>) -> ReadingListItem {
        ReadingListItem {
            id: "i1".into(),
            list_id: "l1".into(),
            paper_id: Some("p1".into()),
            vault_page_id: None,
            sort_order: 1.0,
            note: None,
            inherited_from_list_id: inherited.map(String::from),
            duplicate_of_item_id: None,
        }
    }

    #[test]
    fn item_row_omits_empty_inherited_id() {
        let row = to_item_row(&item(Some("")));
        assert_eq!(row.inherited_from_list_id, None);
        let json = serde_json::to_value(&row).unwrap();
        assert!(json.get("inherited_from_list_id").is_none());
        assert!(json.get("duplicate_of_item_id").is_none());
        assert!(json["vault_page_id"].is_null());
    }

    #[test]
    fn item_row_keeps_set_inherited_id() {
        let row = to_item_row(&item(Some("parent")));
        assert_eq!(row.inherited_from_list_id.as_deref(), Some("parent"));
    }

    #[test]
    fn list_domain_round_trips_row() {
        let row = ReadingListRow {
            id: "l1".into(),
            name: "Reading".into(),
            description: None,
            parent_id: Some("root".into()),
            sort_order: 2.0,
            color: None,
            created_at: "2026-01-01T00:00:00Z".into(),
        };
        assert_eq!(to_list_row(&to_list_domain(&row)), row);
    }
}
