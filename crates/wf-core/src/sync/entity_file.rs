//! One workspace entity file (note, report section, experiment, milestone or
//! log entry): `weaveforge-id`, `weaveforge-type`, optional `wf`, the other
//! frontmatter fields in file order, and the body.
//!
//! Laws (proved in `tests/vault_files.rs`):
//! - `parse_entity_file(render_entity_file(f)) == f` for single-line fields.
//! - CRLF and non-NFC text are normalised once; a second render is a no-op.
//! - Unknown fields are kept, in file order.
//! - `replace_body` changes only the body: the id and every field stay.

use serde_json::{Map, Value};

use super::frontmatter::{canonical_text, frontmatter_string, read_frontmatter, write_frontmatter};

const ID_KEY: &str = "weaveforge-id";
const TYPE_KEY: &str = "weaveforge-type";
const WF_KEY: &str = "wf";

/// A parsed entity file.
#[derive(Debug, Clone, PartialEq)]
pub struct EntityFile {
    /// `weaveforge-id`, stable for the life of the item.
    pub id: String,
    /// `weaveforge-type`, for example `vault_page` or `milestone`.
    pub entity_type: String,
    /// `wf` format version, when the file states one.
    pub wf: Option<u64>,
    /// Every other frontmatter field, in file order, unknown ones included.
    pub fields: Map<String, Value>,
    /// The text after the closing fence, exactly.
    pub body: String,
}

impl EntityFile {
    /// `created-at` as the file states it; the file, not the clock, is the truth.
    #[must_use]
    pub fn created_at(&self) -> Option<String> {
        frontmatter_string(&self.fields, "created-at")
    }

    /// Trimmed text of one field.
    #[must_use]
    pub fn field(&self, key: &str) -> Option<String> {
        frontmatter_string(&self.fields, key)
    }
}

/// Writes `file` in canonical form (LF, NFC).
#[must_use]
pub fn render_entity_file(file: &EntityFile) -> String {
    let mut pairs = vec![
        (ID_KEY.to_owned(), Value::String(file.id.clone())),
        (TYPE_KEY.to_owned(), Value::String(file.entity_type.clone())),
    ];
    if let Some(wf) = file.wf {
        pairs.push((WF_KEY.to_owned(), Value::from(wf)));
    }
    pairs.extend(
        file.fields
            .iter()
            .filter(|(key, _)| match key.as_str() {
                ID_KEY | TYPE_KEY => false,
                WF_KEY => file.wf.is_none(),
                _ => true,
            })
            .map(|(key, value)| (key.clone(), value.clone())),
    );
    canonical_text(&write_frontmatter(&pairs, &file.body))
}

/// Reads an entity file; `None` when it has no `weaveforge-id` or type.
#[must_use]
pub fn parse_entity_file(text: &str) -> Option<EntityFile> {
    let parsed = read_frontmatter(&canonical_text(text));
    let mut fields = parsed.frontmatter;
    let id = frontmatter_string(&fields, ID_KEY)?;
    let entity_type = frontmatter_string(&fields, TYPE_KEY)?;
    let wf = fields.get(WF_KEY).and_then(Value::as_u64);
    let _ = fields.shift_remove(ID_KEY);
    let _ = fields.shift_remove(TYPE_KEY);
    if wf.is_some() {
        let _ = fields.shift_remove(WF_KEY);
    }
    Some(EntityFile {
        id,
        entity_type,
        wf,
        fields,
        body: parsed.body,
    })
}

/// `text` with one frontmatter field set to `value`; every other line stays as
/// it was. A missing field is added just before the closing fence. `None` when
/// `text` has no frontmatter or `value` cannot be written (null, empty list).
#[must_use]
pub fn set_field(text: &str, key: &str, value: &Value) -> Option<String> {
    let text = canonical_text(text);
    let one = write_frontmatter(&[(key.to_owned(), value.clone())], "");
    let line = one.strip_prefix("---\n")?.strip_suffix("\n---\n")?;
    let block = text.strip_prefix("---\n")?;
    let close = block.find("\n---")?;
    let (head, tail) = block.split_at(close);
    let prefix = format!("{key}:");
    let mut found = false;
    let mut lines: Vec<&str> = head
        .split('\n')
        .map(|current| {
            if !found && current.starts_with(&prefix) {
                found = true;
                line
            } else {
                current
            }
        })
        .collect();
    if !found {
        lines.push(line);
    }
    Some(format!("---\n{}{tail}", lines.join("\n")))
}

/// `text` with its body swapped for `body`; the frontmatter bytes are kept
/// as they are, then the whole is put in canonical form.
#[must_use]
pub fn replace_body(text: &str, body: &str) -> String {
    let old_body_len = read_frontmatter(text).body.len();
    let head = text.get(..text.len() - old_body_len).unwrap_or_default();
    canonical_text(&format!("{head}{body}"))
}
