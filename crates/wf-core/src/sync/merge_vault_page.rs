//! Port of `packages/core/src/workspace/merge-vault-page.ts`: merges a vault
//! note edited on both sides. Fields go through `merge_rows`; the body is
//! compared by digest only, so no base text is kept.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::sync::change_origin::digest_text;
use crate::sync::deserialize::{ParsedEntity, parse_workspace_file};
use crate::sync::folder_layout::WorkspaceEntityType;
use crate::sync::merge::{Conflict, merge_rows};

/// The note as it stood when the two sides last agreed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct VaultPageBase {
    /// Frontmatter fields, with `title` included. Usually an object; an array survives
    /// a manifest round trip as-is and merges as having no named fields.
    #[cfg_attr(feature = "specta", specta(type = specta_typescript::Unknown))]
    pub fields: Value,
    /// Digest, not text: enough to tell a rewrite from an untouched body.
    pub body_digest: String,
}

/// One side's current copy.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct VaultPageSide {
    /// Frontmatter fields, with `title` included.
    #[cfg_attr(feature = "specta", specta(type = std::collections::BTreeMap<String, specta_typescript::Unknown>))]
    pub fields: Map<String, Value>,
    /// Body text after the frontmatter.
    pub body: String,
}

/// The merged note and the conflicts the reader has to decide.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct VaultPageMerge {
    /// Merged frontmatter fields.
    #[cfg_attr(feature = "specta", specta(type = std::collections::BTreeMap<String, specta_typescript::Unknown>))]
    pub fields: Map<String, Value>,
    /// Merged body text.
    pub body: String,
    /// Empty when the merge settled everything. `body` appears as its own field.
    pub conflicts: Vec<Conflict>,
}

/// Merges the folder's copy and the workspace's copy over the base.
///
/// A field only one side moved is taken from that side; a body only one side
/// moved is taken from that side. Anything both sides moved differently is
/// reported, and the workspace's value stands meanwhile.
#[must_use]
pub fn merge_vault_page(
    base: &VaultPageBase,
    folder: &VaultPageSide,
    workspace: &VaultPageSide,
) -> VaultPageMerge {
    let no_fields = Map::new();
    // An array base (kept as read from a manifest) has no named fields.
    let base_fields = base.fields.as_object().unwrap_or(&no_fields);
    let result = merge_rows(base_fields, &folder.fields, &workspace.fields);
    let mut conflicts = result.conflicts;

    let folder_digest = digest_text(&folder.body);
    let workspace_digest = digest_text(&workspace.body);
    let folder_moved = folder_digest != base.body_digest;
    let workspace_moved = workspace_digest != base.body_digest;

    let mut body = workspace.body.clone();
    if folder_moved && !workspace_moved {
        body = folder.body.clone();
    } else if folder_moved && workspace_moved && folder_digest != workspace_digest {
        conflicts.push(Conflict {
            field: "body".to_owned(),
            base: Value::String(base.body_digest.clone()),
            local: Value::String(folder_digest),
            remote: Value::String(workspace_digest),
        });
    }

    VaultPageMerge {
        fields: result.merged,
        body,
        conflicts,
    }
}

/// The base a mirrored file leaves behind. `None` unless the file is a vault page.
#[must_use]
pub fn vault_page_base(path: &str, content: &str) -> Option<VaultPageBase> {
    let parsed = vault_page(path, content)?;
    let body_digest = digest_text(&parsed.body);
    Some(VaultPageBase {
        fields: Value::Object(with_title(parsed.fields, &parsed.title)),
        body_digest,
    })
}

/// One side of the merge, read from the file that side holds. `None` unless the file is a vault page.
#[must_use]
pub fn vault_page_side(path: &str, content: &str) -> Option<VaultPageSide> {
    let parsed = vault_page(path, content)?;
    Some(VaultPageSide {
        fields: with_title(parsed.fields, &parsed.title),
        body: parsed.body,
    })
}

fn vault_page(path: &str, content: &str) -> Option<ParsedEntity> {
    let parsed = parse_workspace_file(path, content)?;
    (parsed.entity_type == WorkspaceEntityType::VaultPage).then_some(parsed)
}

fn with_title(mut fields: Map<String, Value>, title: &str) -> Map<String, Value> {
    let _ = fields.insert("title".to_owned(), Value::String(title.to_owned()));
    fields
}
