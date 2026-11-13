//! Overleaf project tree flattening (TS `workshop-live-client` `flattenDocs` / `flattenFiles`).
//! The walk is here; the sort by path stays in the web app, which orders by the locale it shows.

use serde::Serialize;
use serde_json::Value;

/// One file of an Overleaf project, by its path from the project root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LiveDocEntry {
    /// Overleaf's id for the file.
    pub id: String,
    /// The path from the project root, with `/` between folders.
    pub path: String,
}

/// Which list of each folder to walk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TreeKind {
    /// The editable text files (`docs`).
    Docs,
    /// The binary files, such as images and PDFs (`fileRefs`).
    FileRefs,
}

/// Every entry of `kind` under the root folders, in walk order (each folder's own files
/// before its subfolders). Entries without a string `_id` and `name` are skipped.
#[must_use]
pub fn flatten(root_folders: &Value, kind: TreeKind) -> Vec<LiveDocEntry> {
    let key = match kind {
        TreeKind::Docs => "docs",
        TreeKind::FileRefs => "fileRefs",
    };
    let mut out = Vec::new();
    if let Some(roots) = root_folders.as_array() {
        for root in roots {
            walk(root, "", key, &mut out);
        }
    }
    out
}

fn walk(folder: &Value, prefix: &str, key: &str, out: &mut Vec<LiveDocEntry>) {
    if let Some(entries) = folder.get(key).and_then(Value::as_array) {
        for entry in entries {
            let id = entry.get("_id").and_then(Value::as_str);
            let name = entry.get("name").and_then(Value::as_str);
            if let (Some(id), Some(name)) = (id, name) {
                out.push(LiveDocEntry {
                    id: id.to_owned(),
                    path: format!("{prefix}{name}"),
                });
            }
        }
    }
    if let Some(children) = folder.get("folders").and_then(Value::as_array) {
        for child in children {
            if let Some(name) = child.get("name").and_then(Value::as_str) {
                walk(child, &format!("{prefix}{name}/"), key, out);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tree() -> Value {
        json!([{
            "docs": [{ "_id": "d1", "name": "main.tex" }],
            "fileRefs": [{ "_id": "f0", "name": "logo.png" }],
            "folders": [{
                "name": "chapters",
                "docs": [{ "_id": "d2", "name": "intro.tex" }],
                "fileRefs": [{ "_id": "f1", "name": "figure.png" }],
                "folders": []
            }]
        }])
    }

    #[test]
    fn docs_walk_in_order_with_folder_prefixes() {
        let paths: Vec<String> = flatten(&tree(), TreeKind::Docs)
            .into_iter()
            .map(|e| e.path)
            .collect();
        assert_eq!(paths, ["main.tex", "chapters/intro.tex"]);
    }

    #[test]
    fn file_refs_use_their_own_list() {
        let files = flatten(&tree(), TreeKind::FileRefs);
        assert_eq!(files.len(), 2);
        assert_eq!(
            files[0],
            LiveDocEntry {
                id: "f0".into(),
                path: "logo.png".into()
            }
        );
        assert_eq!(files[1].path, "chapters/figure.png");
    }

    #[test]
    fn skips_entries_without_string_id_or_name() {
        let root = json!([{ "docs": [{ "_id": 3, "name": "bad.tex" }, { "_id": "d9" }], "folders": [{}] }]);
        assert!(flatten(&root, TreeKind::Docs).is_empty());
    }

    #[test]
    fn non_array_root_gives_no_entries() {
        assert!(flatten(&Value::Null, TreeKind::Docs).is_empty());
        assert!(flatten(&json!({}), TreeKind::FileRefs).is_empty());
    }
}
