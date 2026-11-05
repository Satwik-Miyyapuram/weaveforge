//! Read helpers for the folder MCP: entries, sections, windows and cached paper pages.
//! Ported from apps/shell/sidecar/src/local-mcp.ts (PROTOCOL_VERSION through cachedPages).

use std::time::SystemTime;

use serde_json::{Map, Value, json};
use wf_core::ai::mcp_result::mcp_read_result;
use wf_core::ai::untrusted_context::UntrustedItem;
use wf_core::sync::deserialize::parse_workspace_file;
use wf_core::sync::folder_layout::{
    ENTITY_DIRS, WORKSPACE_META_DIR, WorkspaceEntityType, entity_dir,
};

use super::mcp_projects::{ProjectRef, norm};
use crate::vault::{EntryKindPayload, VaultSession, iso_utc};
use crate::vault_search::walk_vault;

/// The protocol version the server answers with.
pub(crate) const PROTOCOL_VERSION: &str = "2025-06-18";
/// The reader's page-text cache. `concat!` cannot take `WORKSPACE_META_DIR`, so this repeats it.
pub(crate) const PDF_TEXT_DIR: &str = ".weaveforge/cache/pdf-text";
/// Longest paper text returned whole, in characters.
pub(crate) const MAX_PAPER_TEXT_CHARS: usize = 60_000;
/// Under the per-item cap, so the paging note is never the part cut off.
pub(crate) const PAGE_CHARS: usize = 7_500;
/// Most rows a list tool returns.
pub(crate) const MAX_ROWS: usize = 500;
/// OS folder-junk names, compared lowercased.
pub(crate) const JUNK_FILES: &[&str] = &["desktop.ini", ".ds_store", "thumbs.db"];

/// A parsed workspace file, with its raw text and the project it belongs to.
#[derive(Debug, Clone)]
pub(crate) struct Entry {
    /// The `weaveforge-id` the file declares, if any.
    pub(crate) id: Option<String>,
    /// What kind of entity the file is.
    pub(crate) entity_type: WorkspaceEntityType,
    /// The title, from frontmatter or the file name.
    pub(crate) title: String,
    /// The body after frontmatter.
    pub(crate) body: String,
    /// The file's path in the vault.
    pub(crate) path: String,
    /// Frontmatter fields other than id, type and title.
    pub(crate) fields: Map<String, Value>,
    /// The whole file as read.
    pub(crate) raw: String,
    /// The project the file belongs to.
    pub(crate) project: ProjectRef,
}

/// A tool answer, fenced and bounded, in the shape MCP expects.
///
/// # Errors
/// No fence nonce could be drawn from the OS.
pub(crate) fn content(items: &[UntrustedItem]) -> Result<Value, String> {
    let nonce = random_nonce()?;
    let result = mcp_read_result(items, None, None, &nonce);
    Ok(json!({
        "content": [{ "type": "text", "text": result.text }],
        "_meta": { "nonce": result.nonce, "omitted": result.omitted, "truncated": result.truncated },
    }))
}

/// A fresh fence nonce: 16 random bytes as 32 lowercase hex chars.
///
/// # Errors
/// The OS random source failed.
pub(crate) fn random_nonce() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|err| err.to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Sortable, filename-safe, second-resolution: `2026-10-30T12-34-56`.
#[must_use]
pub(crate) fn stamp() -> String {
    iso_utc(SystemTime::now())
        .replace([':', '.'], "-")
        .chars()
        .take(19)
        .collect()
}

/// Junk names and dot-names anywhere in a `/`-separated path.
#[must_use]
pub(crate) fn hidden(path: &str) -> bool {
    path.split('/')
        .any(|part| part.starts_with('.') || JUNK_FILES.contains(&part.to_lowercase().as_str()))
}

/// Text of a vault file, or `None` when there is none.
///
/// # Errors
/// The read itself failed.
pub(crate) fn read_text(session: &VaultSession, path: &str) -> Result<Option<String>, String> {
    session.read_text(path)
}

/// Every parsed entry of one kind in one project's own folder; junk and hidden files skipped.
///
/// # Errors
/// A file could not be read.
pub(crate) fn load_project_entries(
    session: &VaultSession,
    kind: WorkspaceEntityType,
    project: &ProjectRef,
) -> Result<Vec<Entry>, String> {
    let mut files = Vec::new();
    walk_vault(session, &entity_dir(kind, &project.dir), &mut files);
    let mut entries = Vec::new();
    for file in files {
        if !file.ends_with(".md") || hidden(&file) {
            continue;
        }
        let Some(raw) = read_text(session, &file)? else {
            continue;
        };
        let Some(parsed) = parse_workspace_file(&file, &raw) else {
            continue;
        };
        let wanted = parsed.entity_type == kind
            || (kind == WorkspaceEntityType::VaultPage
                && parsed.entity_type == WorkspaceEntityType::InkPage);
        if wanted {
            entries.push(Entry {
                id: parsed.id,
                entity_type: parsed.entity_type,
                title: parsed.title,
                body: parsed.body,
                path: parsed.path,
                fields: parsed.fields,
                raw,
                project: project.clone(),
            });
        }
    }
    Ok(entries)
}

/// Entries of one kind across the given projects, in project order.
///
/// # Errors
/// A file could not be read.
pub(crate) fn load_entries(
    session: &VaultSession,
    kind: WorkspaceEntityType,
    projects: &[ProjectRef],
) -> Result<Vec<Entry>, String> {
    let mut entries = Vec::new();
    for project in projects {
        entries.extend(load_project_entries(session, kind, project)?);
    }
    Ok(entries)
}

/// A short label: the title and the id, or the path when there is no id.
#[must_use]
pub(crate) fn describe(entry: &Entry) -> String {
    format!(
        "{} ({})",
        entry.title,
        entry.id.as_deref().unwrap_or(entry.path.as_str())
    )
}

/// A title with what it is: "paper" for papers, "note" for everything else.
#[must_use]
pub(crate) fn named(entry: &Entry) -> String {
    let what = if entry.entity_type == WorkspaceEntityType::Paper {
        "paper"
    } else {
        "note"
    };
    format!("{} ({what})", entry.title)
}

/// Id first, then exact title, then a unique partial title or path; two matches is a question back.
///
/// # Errors
/// No usable needle, no match, or more than one match.
pub(crate) fn pick(entries: &[Entry], needle: &Value, what: &str) -> Result<Entry, String> {
    let wanted = needle.as_str().map(norm).unwrap_or_default();
    if wanted.is_empty() {
        return Err(format!("That needs a {what} id or title."));
    }
    if let Some(entry) = entries.iter().find(|entry| {
        entry
            .id
            .as_deref()
            .is_some_and(|id| id.to_lowercase() == wanted)
    }) {
        return Ok(entry.clone());
    }
    let exact: Vec<&Entry> = entries
        .iter()
        .filter(|entry| norm(&entry.title) == wanted)
        .collect();
    let found: Vec<&Entry> = if exact.is_empty() {
        entries
            .iter()
            .filter(|entry| {
                norm(&entry.title).contains(wanted.as_str())
                    || entry.path.to_lowercase().contains(wanted.as_str())
            })
            .collect()
    } else {
        exact
    };
    match found.as_slice() {
        [] => Err(format!("No {what} matches '{wanted}'.")),
        [only] => Ok((*only).clone()),
        many => {
            let listed = many
                .iter()
                .take(10)
                .map(|entry| format!("{} in {}", describe(entry), entry.project.name))
                .collect::<Vec<_>>()
                .join("; ");
            Err(format!(
                "'{wanted}' matches {} of them: {listed}. Use the id or name the project.",
                many.len()
            ))
        }
    }
}

/// The entry's `weaveforge-id`.
///
/// # Errors
/// The file has no id yet.
pub(crate) fn id_of(entry: &Entry) -> Result<String, String> {
    entry.id.clone().filter(|id| !id.is_empty()).ok_or_else(|| {
        format!(
            "{} has no weaveforge-id yet; open the folder in WeaveForge once so it gets one.",
            entry.path
        )
    })
}

/// A non-empty string frontmatter field, or `None`.
#[must_use]
pub(crate) fn field(entry: &Entry, key: &str) -> Option<String> {
    entry
        .fields
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// The rows of a JSON array file in a project's workspace folder; non-object rows dropped.
///
/// # Errors
/// The read itself failed. A missing or torn file is an empty list.
pub(crate) fn read_json_array(
    session: &VaultSession,
    project: &ProjectRef,
    name: &str,
) -> Result<Vec<Map<String, Value>>, String> {
    let prefix = if project.dir.is_empty() {
        String::new()
    } else {
        format!("{}/", project.dir)
    };
    let Some(raw) = read_text(session, &format!("{prefix}{WORKSPACE_META_DIR}/{name}"))? else {
        return Ok(Vec::new());
    };
    let Ok(Value::Array(rows)) = serde_json::from_str::<Value>(&raw) else {
        return Ok(Vec::new());
    };
    Ok(rows
        .into_iter()
        .filter_map(|row| match row {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .collect())
}

/// The trimmed string at `key`; `None` when blank.
///
/// # Errors
/// `required` is set and the value is blank.
pub(crate) fn text(
    params: &Map<String, Value>,
    key: &str,
    required: bool,
) -> Result<Option<String>, String> {
    let trimmed = params
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if trimmed.is_empty() {
        if required {
            return Err(format!("{key} is required."));
        }
        return Ok(None);
    }
    Ok(Some(trimmed.to_owned()))
}

/// `text` limited to the `allowed` values.
///
/// # Errors
/// Blank while required, or not one of `allowed`.
pub(crate) fn one_of(
    params: &Map<String, Value>,
    key: &str,
    allowed: &[&str],
    required: bool,
) -> Result<Option<String>, String> {
    let Some(value) = text(params, key, required)? else {
        return Ok(None);
    };
    if allowed.contains(&value.as_str()) {
        Ok(Some(value))
    } else {
        Err(format!("{key} must be one of: {}.", allowed.join(", ")))
    }
}

/// The entity type named by `params.kind`; the ink-page kind is folded into notes, so it is not offered.
#[must_use]
pub(crate) fn kind_of(params: &Map<String, Value>) -> Option<WorkspaceEntityType> {
    let name = params.get("kind").and_then(Value::as_str)?;
    ENTITY_DIRS
        .iter()
        .map(|(kind, _)| *kind)
        .filter(|kind| *kind != WorkspaceEntityType::InkPage)
        .find(|kind| kind.as_str() == name)
}

/// The target of a get: `ref`, or the tool's older name for it.
#[must_use]
pub(crate) fn ref_param(params: &Map<String, Value>, older: &str) -> Value {
    match text(params, "ref", false) {
        Ok(Some(value)) => Value::String(value),
        _ => params.get(older).cloned().unwrap_or(Value::Null),
    }
}

/// A JS-`Number`-style read of a JSON value; `None` where JS would give NaN.
#[must_use]
pub(crate) fn number_of(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Null => Some(0.0),
        Value::Bool(flag) => Some(f64::from(u8::from(*flag))),
        Value::Number(number) => number.as_f64(),
        Value::String(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                Some(0.0)
            } else {
                trimmed.parse::<f64>().ok()
            }
        }
        _ => None,
    }
}

/// A count from `params`, floored and clamped to `max`; `fallback` when absent, negative or not finite.
#[must_use]
pub(crate) fn count(params: &Map<String, Value>, key: &str, fallback: usize, max: usize) -> usize {
    let Some(number) = number_of(params.get(key)) else {
        return fallback;
    };
    let floored = number.floor();
    if !floored.is_finite() || floored < 0.0 {
        return fallback;
    }
    // Digits, not `as`: a value past usize fails to parse and clamps to max.
    let whole = format!("{:.0}", floored.abs());
    whole.parse::<usize>().map_or(max, |value| value.min(max))
}

/// The markdown heading level of a line (1 to 6), or 0 when the line is not a heading.
#[must_use]
pub(crate) fn heading_level(line: &str) -> usize {
    let hashes = line.bytes().take_while(|byte| *byte == b'#').count();
    let is_heading = (1..=6).contains(&hashes)
        && line[hashes..]
            .chars()
            .next()
            .is_some_and(char::is_whitespace);
    if is_heading { hashes } else { 0 }
}

/// One markdown heading's section, through the next heading of the same or a higher level.
///
/// # Errors
/// No heading matches; the message lists the headings there are.
pub(crate) fn section(raw: &str, heading: &str) -> Result<String, String> {
    let lines: Vec<&str> = raw
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect();
    let wanted = norm(heading);
    let Some(start) = lines.iter().position(|&line| {
        heading_level(line) > 0 && norm(line.trim_start_matches('#').trim_start()) == wanted
    }) else {
        let all: Vec<&str> = lines
            .iter()
            .copied()
            .filter(|line| heading_level(line) > 0)
            .map(|line| line.trim_start_matches('#').trim_start())
            .collect();
        let listed = if all.is_empty() {
            "(none)".to_owned()
        } else {
            all.join("; ")
        };
        return Err(format!("No section '{heading}'. Sections: {listed}."));
    };
    let depth = heading_level(lines[start]);
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find(|(_, line)| heading_level(line) > 0 && heading_level(line) <= depth)
        .map_or(lines.len(), |(index, _)| index);
    Ok(lines[start..end].join("\n"))
}

/// A window on a long text, saying where the next one starts, so nothing is cut silently.
///
/// # Errors
/// The heading is missing, or `offset` is past the end.
pub(crate) fn windowed(raw: &str, params: &Map<String, Value>) -> Result<String, String> {
    let body = match text(params, "heading", false)? {
        Some(heading) => section(raw, &heading)?,
        None => raw.to_owned(),
    };
    // Characters, not UTF-16 units: offsets are character offsets here.
    let total = body.chars().count();
    let offset = count(params, "offset", 0, usize::MAX);
    if offset > 0 && offset >= total {
        return Err(format!(
            "offset {offset} is past the end ({total} characters)."
        ));
    }
    let limit = match count(params, "limit", PAGE_CHARS, PAGE_CHARS) {
        0 => PAGE_CHARS,
        n => n,
    };
    let end = total.min(offset.saturating_add(limit));
    if offset == 0 && end == total {
        return Ok(body);
    }
    let more = if end < total {
        format!("; pass offset={end} for more")
    } else {
        String::new()
    };
    let piece: String = body
        .chars()
        .skip(offset)
        .take(end.saturating_sub(offset))
        .collect();
    Ok(format!(
        "{piece}\n[characters {offset}-{end} of {total}{more}]"
    ))
}

/// `encodeURIComponent`: UTF-8 bytes, with everything but unreserved ASCII percent-encoded.
#[must_use]
pub(crate) fn encode_uri_component(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Page text from the reader's cache; one subfolder per project, so every one is looked in.
///
/// Each page is a JSON value with `pageIndex` and `text`, passed through unchecked.
///
/// # Errors
/// A cache file could not be read. A missing or torn cache is `None`.
pub(crate) fn cached_pages(
    session: &VaultSession,
    paper_id: &str,
) -> Result<Option<Vec<Value>>, String> {
    let Ok(listed) = session.list(Some(PDF_TEXT_DIR)) else {
        return Ok(None);
    };
    for dir in listed {
        if dir.kind != EntryKindPayload::Dir {
            continue;
        }
        let path = format!("{}/{}.json", dir.path, encode_uri_component(paper_id));
        let Some(raw) = read_text(session, &path)? else {
            continue;
        };
        // A torn cache file is the same as none.
        let Ok(doc) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        if let Some(Value::Array(pages)) = doc.get("pages") {
            return Ok(Some(pages.clone()));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn params(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(map) => map,
            _ => Map::new(),
        }
    }

    #[test]
    fn section_takes_heading_through_next_same_level() {
        let raw = "# Top\nintro\n## Methods\nm1\n### Sub\ns\n## Results\nr";
        assert_eq!(
            section(raw, "methods").expect("found"),
            "## Methods\nm1\n### Sub\ns"
        );
        let err = section(raw, "missing").expect_err("no such heading");
        assert!(
            err.contains("Sections: Top; Methods; Sub; Results."),
            "{err}"
        );
    }

    #[test]
    fn windowed_pages_and_names_next_offset() {
        let raw = "abcdefghij";
        let first = windowed(raw, &params(json!({ "limit": 4 }))).expect("first window");
        assert_eq!(
            first,
            "abcd\n[characters 0-4 of 10; pass offset=4 for more]"
        );
        let tail = windowed(raw, &params(json!({ "offset": 8, "limit": 4 }))).expect("tail window");
        assert_eq!(tail, "ij\n[characters 8-10 of 10]");
        assert!(windowed(raw, &params(json!({ "offset": 10 }))).is_err());
    }

    #[test]
    fn count_floors_clamps_and_falls_back() {
        assert_eq!(count(&params(json!({ "n": 3.9 })), "n", 1, 10), 3);
        assert_eq!(count(&params(json!({ "n": 99 })), "n", 1, 10), 10);
        assert_eq!(count(&params(json!({ "n": -2 })), "n", 1, 10), 1);
        assert_eq!(count(&params(json!({ "n": "7" })), "n", 1, 10), 7);
        assert_eq!(count(&params(json!({})), "n", 1, 10), 1);
    }

    #[test]
    fn text_trims_blank_is_none_and_one_of_rejects_unknown() {
        let p = params(json!({ "ref": "  Alpha  ", "blank": "   " }));
        assert_eq!(
            text(&p, "ref", false).expect("ok"),
            Some("Alpha".to_owned())
        );
        assert_eq!(text(&p, "blank", false).expect("ok"), None);
        assert!(text(&p, "blank", true).is_err());
        assert_eq!(
            one_of(&p, "ref", &["Alpha"], false).expect("ok"),
            Some("Alpha".to_owned())
        );
        assert!(one_of(&p, "ref", &["beta"], false).is_err());
    }

    #[test]
    fn pdf_cache_dir_sits_under_meta_dir() {
        assert_eq!(PDF_TEXT_DIR, format!("{WORKSPACE_META_DIR}/cache/pdf-text"));
    }
}
