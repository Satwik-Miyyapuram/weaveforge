//! Suggestion files the local MCP leaves in the workspace (TS mcp-folder-draft.ts).

use serde_json::{Map, Value};

use super::access_policy::AiProposalKind;
use crate::search::js_text::{is_js_whitespace, utf16_len};

/// Where the local MCP leaves suggestions for the app to pick up; never applied on its own.
pub const FOLDER_DRAFTS_DIR: &str = ".weaveforge/proposals";

/// Longest accepted file, in UTF-16 units.
const MAX_RAW_CHARS: usize = 256 * 1024;
/// Longest accepted draft content, in UTF-16 units.
const MAX_CONTENT_CHARS: usize = 64 * 1024;
/// Longest accepted id, in UTF-16 units.
const MAX_ID_CHARS: usize = 512;

/// One suggestion file the app may import (TS `FolderDraft`).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderDraft {
    /// The change the app applies on approval.
    pub kind: AiProposalKind,
    /// The tool that wrote it; `local-mcp` when absent.
    pub tool: String,
    /// The entity it changes.
    pub resource_id: String,
    /// The entity's type, kept as text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_type: Option<String>,
    /// The suggestion's text.
    pub content: String,
    /// Fields of the change.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Map<String, Value>>,
    /// Links the agent cited.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_links: Option<Vec<String>>,
    /// The revision the change was written against.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<String>,
    /// When it was written.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// The project it belongs to; absent means whichever project imports it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
}

/// A draft file's parsed form, or `None` when it is not one; the file is agent-written, so nothing is trusted.
#[must_use]
pub fn parse_folder_draft(raw: &str) -> Option<FolderDraft> {
    if utf16_len(raw) > MAX_RAW_CHARS {
        return None;
    }
    let value: Value = serde_json::from_str(raw).ok()?;
    let obj = value.as_object()?;
    let kind: AiProposalKind = serde_json::from_value(obj.get("kind")?.clone()).ok()?;
    let resource_id = optional_string(obj.get("resourceId"))?;
    if utf16_len(&resource_id) > MAX_ID_CHARS {
        return None;
    }
    let content = optional_string(obj.get("content"))?;
    if utf16_len(&content) > MAX_CONTENT_CHARS {
        return None;
    }
    let payload = match obj.get("payload") {
        None => None,
        Some(Value::Object(map)) => Some(map.clone()),
        Some(_) => return None,
    };
    let source_links = match obj.get("sourceLinks") {
        None => None,
        Some(Value::Array(items)) => Some(
            items
                .iter()
                .map(|item| item.as_str().map(str::to_owned))
                .collect::<Option<Vec<String>>>()?,
        ),
        Some(_) => return None,
    };
    let project_id = optional_string(obj.get("projectId"));
    if project_id
        .as_deref()
        .is_some_and(|id| utf16_len(id) > MAX_ID_CHARS)
    {
        return None;
    }
    Some(FolderDraft {
        kind,
        tool: optional_string(obj.get("tool")).unwrap_or_else(|| "local-mcp".to_owned()),
        resource_id,
        resource_type: optional_string(obj.get("resourceType")),
        content,
        payload,
        source_links,
        expected_revision: optional_string(obj.get("expectedRevision")),
        created_at: optional_string(obj.get("createdAt")),
        project_id,
    })
}

/// `None` for an absent, non-string, or blank value; otherwise the trimmed text (TS `optionalString`).
fn optional_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(|s| s.trim_matches(is_js_whitespace))
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn valid() -> Value {
        json!({ "kind": "create_vault_note", "resourceId": " n1 ", "content": " body ", "tool": "t" })
    }

    #[test]
    fn parses_and_trims() {
        let draft = parse_folder_draft(&valid().to_string()).expect("valid");
        assert_eq!(draft.kind, AiProposalKind::CreateVaultNote);
        assert_eq!(draft.resource_id, "n1");
        assert_eq!(draft.content, "body");
        assert_eq!(draft.tool, "t");
        assert_eq!(draft.project_id, None);
    }

    #[test]
    fn tool_defaults_to_local_mcp() {
        let mut v = valid();
        let _ = v.as_object_mut().unwrap().remove("tool");
        assert_eq!(
            parse_folder_draft(&v.to_string()).unwrap().tool,
            "local-mcp"
        );
    }

    #[test]
    fn rejects_bad_input() {
        for raw in [
            "not json",
            "[]",
            r#"{"kind":"nope","resourceId":"a","content":"b"}"#,
            r#"{"kind":"create_vault_note","resourceId":"  ","content":"b"}"#,
            r#"{"kind":"create_vault_note","resourceId":"a","content":"b","payload":[]}"#,
            r#"{"kind":"create_vault_note","resourceId":"a","content":"b","sourceLinks":[1]}"#,
        ] {
            assert_eq!(parse_folder_draft(raw), None, "{raw}");
        }
        let long = json!({ "kind": "create_vault_note", "resourceId": "a", "content": "x".repeat(70_000) });
        assert_eq!(parse_folder_draft(&long.to_string()), None);
        let long_project = json!({ "kind": "create_vault_note", "resourceId": "a", "content": "b", "projectId": "x".repeat(513) });
        assert_eq!(parse_folder_draft(&long_project.to_string()), None);
    }

    #[test]
    fn serializes_without_absent_keys() {
        let draft = parse_folder_draft(&valid().to_string()).unwrap();
        let out = serde_json::to_value(&draft).unwrap();
        assert_eq!(
            out,
            json!({ "kind": "create_vault_note", "tool": "t", "resourceId": "n1", "content": "body" })
        );
    }
}
