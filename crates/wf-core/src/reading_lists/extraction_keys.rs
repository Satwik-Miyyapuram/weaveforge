//! Keys and labels for extraction-table cells: the pending-fill lookup key and the relation cell
//! text (TS `apps/web/.../reading-lists/application/extraction-rows.ts`).

use std::collections::HashMap;

/// The lookup key for one cell: the paper id and field id joined by `::` (TS `pendingKey`).
#[must_use]
pub fn pending_key(paper_id: &str, field_id: &str) -> String {
    format!("{paper_id}::{field_id}")
}

/// The titles of related papers, joined by `, ` in the order given. An id with no title is shown
/// as the id itself, which is how a paper that was deleted still appears (TS `relationTitles`).
#[must_use]
pub fn relation_titles(ids: &[String], title_by_id: &HashMap<String, String>) -> String {
    ids.iter()
        .map(|id| title_by_id.get(id).map_or(id.as_str(), String::as_str))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_key_joins_paper_and_field_with_double_colon() {
        assert_eq!(pending_key("p2", "f1"), "p2::f1");
    }

    #[test]
    fn relation_titles_name_each_paper_and_fall_back_to_the_id() {
        let titles: HashMap<String, String> = [("p1", "Alpha"), ("p2", "Beta")]
            .into_iter()
            .map(|(id, title)| (id.to_owned(), title.to_owned()))
            .collect();
        let ids = ["p2", "gone", "p1"].map(str::to_owned);
        assert_eq!(relation_titles(&ids, &titles), "Beta, gone, Alpha");
        assert_eq!(relation_titles(&[], &titles), "");
    }
}
