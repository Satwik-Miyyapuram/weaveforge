//! Notes import rules: which files are read, and wikilink rewrites after titles are auto-suffixed.
//! A port of the pure parts of `apps/web/src/features/vault/application/import-notes.ts`.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

use crate::papers::js_regex::compile;
use crate::reader_analysis::lines::{js_trim, js_trim_end};
use crate::sync::folder_layout::strip_kind_suffix;
use crate::vault::page::{normalize_title_key, unique_title};

/// `/\[\[([^\[\]\n]+?)\]\]/g`: a wikilink, with its inner text captured.
static WIKILINK_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"\[\[([^\[\]\n]+?)\]\]").ok());

/// Rewrites `[[Old]]`, `[[Old|alias]]` and `[[Old#heading]]` when `Old` was renamed on import.
///
/// `renames` maps a normalised old title (see [`normalize_title_key`]) to its new title. A link
/// whose target has no rename, or an empty one, is left as written.
#[must_use]
pub fn rewrite_wikilinks(body: &str, renames: &BTreeMap<String, String>) -> String {
    if renames.is_empty() {
        return body.to_owned();
    }
    let Some(re) = WIKILINK_RE.as_ref() else {
        return body.to_owned();
    };
    re.replace_all(body, |caps: &regex_lite::Captures| {
        let raw = &caps[0];
        let inner = &caps[1];
        let (link_part, alias) = match inner.find('|') {
            Some(pipe) => (&inner[..pipe], &inner[pipe..]),
            None => (inner, ""),
        };
        let link = js_trim(link_part);
        let (target_part, rest) = match link.find('#') {
            Some(hash) => (&link[..hash], &link[hash..]),
            None => (link, ""),
        };
        let target = js_trim(target_part);
        match renames.get(&normalize_title_key(target)) {
            Some(next) if !next.is_empty() => format!("[[{next}{rest}{alias}]]"),
            _ => raw.to_owned(),
        }
    })
    .into_owned()
}

/// Whether a picked file is a notes import input: a markdown note or a `.zip` of them.
#[must_use]
pub fn is_note_import_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".zip")
}

/// The note body with its frontmatter tags written as a hashtag line: the body with trailing
/// whitespace trimmed, a blank line, `#tag` per tag joined by spaces, and a newline. No tags
/// leaves the body as it is.
#[must_use]
pub fn with_tag_line(body: &str, tags: &[String]) -> String {
    if tags.is_empty() {
        return body.to_owned();
    }
    let hashtags: Vec<String> = tags.iter().map(|tag| format!("#{tag}")).collect();
    format!("{}\n\n{}\n", js_trim_end(body), hashtags.join(" "))
}

/// Whether a picked file is a markdown note (`.md`, any case).
#[must_use]
pub fn is_markdown_file(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".md")
}

/// Whether a picked file is a `.zip` archive (any case), which an import expands.
#[must_use]
pub fn is_zip_file(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".zip")
}

/// The path an imported file is listed under: `webkit_relative_path` when it is set (an empty
/// string means unset), else `name`, with backslashes read as `/`.
#[must_use]
pub fn import_relative_path(webkit_relative_path: &str, name: &str) -> String {
    let path = if webkit_relative_path.is_empty() {
        name
    } else {
        webkit_relative_path
    };
    path.replace('\\', "/")
}

/// A folder or note renamed on import: the name it had and the title it was given.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportRename {
    /// The base name the item had before its title was made unique.
    pub from: String,
    /// The unique title it was given.
    pub to: String,
}

/// The titles an import gives its folders and notes, decided before any row is written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTitlePlan {
    /// One title per folder key, in the order given.
    pub folder_titles: Vec<String>,
    /// One title per note name, in the order given.
    pub note_titles: Vec<String>,
    /// Folders first, then notes, each whose title differs from its base name.
    pub renamed: Vec<ImportRename>,
    /// Normalised base name to new title, for [`rewrite_wikilinks`]. A later rename of the same
    /// base replaces an earlier one.
    pub rename_map: BTreeMap<String, String>,
}

/// Decides the titles for an import. A folder's base is the last segment of its key; a note's is
/// its name without the entity-kind suffix. Each title is unique against `existing_titles` and the
/// titles already given in this plan, so two items with the same base both get one.
#[must_use]
pub fn plan_import_titles(
    folder_keys: &[String],
    note_names: &[String],
    existing_titles: &[String],
) -> ImportTitlePlan {
    let mut used: Vec<String> = existing_titles
        .iter()
        .map(|title| normalize_title_key(title))
        .collect();
    let mut plan = ImportTitlePlan {
        folder_titles: Vec::with_capacity(folder_keys.len()),
        note_titles: Vec::with_capacity(note_names.len()),
        renamed: Vec::new(),
        rename_map: BTreeMap::new(),
    };
    for key in folder_keys {
        let base = key.rsplit('/').next().unwrap_or(key.as_str());
        let title = take_title(base, &mut used, &mut plan);
        plan.folder_titles.push(title);
    }
    for name in note_names {
        let base = strip_kind_suffix(name);
        let title = take_title(&base, &mut used, &mut plan);
        plan.note_titles.push(title);
    }
    plan
}

/// Picks the unique title for `base`, records its key in `used`, and logs a rename when the title
/// differs from `base`.
fn take_title(base: &str, used: &mut Vec<String>, plan: &mut ImportTitlePlan) -> String {
    let title = unique_title(base, used.as_slice());
    used.push(normalize_title_key(&title));
    if title != base {
        plan.renamed.push(ImportRename {
            from: base.to_owned(),
            to: title.clone(),
        });
        let _ = plan
            .rename_map
            .insert(normalize_title_key(base), title.clone());
    }
    title
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn renames() -> BTreeMap<String, String> {
        BTreeMap::from([
            ("old title".to_owned(), "Old Title 2".to_owned()),
            ("old".to_owned(), "Old 2".to_owned()),
        ])
    }

    #[test]
    fn keeps_alias_and_heading() {
        let body = "see [[Old Title|alias]] and [[Old#sec]] and [[Other]]";
        assert_eq!(
            rewrite_wikilinks(body, &renames()),
            "see [[Old Title 2|alias]] and [[Old 2#sec]] and [[Other]]"
        );
    }

    #[test]
    fn no_renames_leaves_body_alone() {
        let body = "[[Old]]";
        assert_eq!(rewrite_wikilinks(body, &BTreeMap::new()), body);
    }

    #[test]
    fn target_is_trimmed_before_lookup() {
        assert_eq!(rewrite_wikilinks("[[  Old  ]]", &renames()), "[[Old 2]]");
    }

    #[test]
    fn tag_line_trims_body_and_appends_hashtags() {
        let tags = vec!["a".to_owned(), "b c".to_owned()];
        assert_eq!(
            with_tag_line("Body text  \n\n", &tags),
            "Body text\n\n#a #b c\n"
        );
    }

    #[test]
    fn no_tags_keeps_body_as_is() {
        assert_eq!(with_tag_line("Body  \n", &[]), "Body  \n");
    }

    #[test]
    fn import_file_extensions() {
        assert!(is_note_import_file("Note.MD"));
        assert!(is_note_import_file("vault.zip"));
        assert!(!is_note_import_file("image.png"));
        assert!(!is_note_import_file("notes.md.txt"));
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn markdown_and_zip_are_told_apart() {
        assert!(is_markdown_file("A.MD"));
        assert!(!is_markdown_file("a.zip"));
        assert!(is_zip_file("Vault.ZIP"));
        assert!(!is_zip_file("a.md"));
    }

    #[test]
    fn relative_path_prefers_webkit_path_and_uses_slashes() {
        assert_eq!(import_relative_path("", "Note.md"), "Note.md");
        assert_eq!(
            import_relative_path("vault\\sub\\Note.md", "Note.md"),
            "vault/sub/Note.md"
        );
        assert_eq!(
            import_relative_path("vault/Note.md", "Note.md"),
            "vault/Note.md"
        );
    }

    #[test]
    fn plan_uses_folder_last_segment_and_strips_note_suffix() {
        let plan = plan_import_titles(&strings(&["a", "a/b"]), &strings(&["Plain.md"]), &[]);
        assert_eq!(plan.folder_titles, strings(&["a", "b"]));
        assert_eq!(plan.note_titles, strings(&["Plain"]));
        assert!(plan.renamed.is_empty());
        assert!(plan.rename_map.is_empty());
    }

    #[test]
    fn plan_suffixes_clashes_with_existing_and_each_other() {
        let plan = plan_import_titles(
            &strings(&["x/Ref", "y/Ref"]),
            &strings(&["Plan.md", "Plan.md"]),
            &strings(&["plan"]),
        );
        assert_eq!(plan.folder_titles, strings(&["Ref", "Ref (2)"]));
        assert_eq!(plan.note_titles, strings(&["Plan (2)", "Plan (3)"]));
        assert_eq!(
            plan.renamed,
            vec![
                ImportRename {
                    from: "Ref".to_owned(),
                    to: "Ref (2)".to_owned()
                },
                ImportRename {
                    from: "Plan".to_owned(),
                    to: "Plan (2)".to_owned()
                },
                ImportRename {
                    from: "Plan".to_owned(),
                    to: "Plan (3)".to_owned()
                },
            ]
        );
        assert_eq!(
            plan.rename_map.get("ref").map(String::as_str),
            Some("Ref (2)")
        );
        assert_eq!(
            plan.rename_map.get("plan").map(String::as_str),
            Some("Plan (3)")
        );
    }
}
