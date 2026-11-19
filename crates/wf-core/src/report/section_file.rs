//! Report section files: the outline lives in each file's `order` and
//! `parent` frontmatter.
//!
//! Laws (proved in `tests/report_files.rs`):
//! - A reorder changes only the `order` line of the file.
//! - `parent_cycles` names a section exactly when following its parents
//!   comes back to it. Such sections are badged and never rewritten.

use std::collections::{BTreeSet, HashMap};

use serde_json::Value;

use crate::sync::entity_file::{EntityFile, set_field};

/// The section's `order`, a number.
#[must_use]
pub fn section_order(file: &EntityFile) -> Option<f64> {
    file.fields.get("order").and_then(Value::as_f64)
}

/// The id of the parent section, when the file names one.
#[must_use]
pub fn section_parent(file: &EntityFile) -> Option<String> {
    file.field("parent")
}

/// `text` with `order` set to `order`; nothing else changes. `None` for a
/// file without frontmatter or a non-finite order.
#[must_use]
pub fn set_section_order(text: &str, order: f64) -> Option<String> {
    let value = serde_json::Number::from_f64(order)?;
    set_field(text, "order", &Value::Number(value))
}

/// Ids of the sections that sit on a parent cycle, given `(id, parent)` pairs.
#[must_use]
pub fn parent_cycles(links: &[(String, Option<String>)]) -> BTreeSet<String> {
    let parent: HashMap<&str, &str> = links
        .iter()
        .filter_map(|(id, p)| p.as_deref().map(|p| (id.as_str(), p)))
        .collect();
    links
        .iter()
        .filter(|(start, _)| {
            let mut at = parent.get(start.as_str()).copied();
            for _ in 0..links.len() {
                match at {
                    Some(id) if id == start => return true,
                    Some(id) => at = parent.get(id).copied(),
                    None => return false,
                }
            }
            false
        })
        .map(|(id, _)| id.clone())
        .collect()
}
