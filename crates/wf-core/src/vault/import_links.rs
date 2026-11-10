//! Notes import rules: which files are read, and wikilink rewrites after titles are auto-suffixed.
//! A port of the pure parts of `apps/web/src/features/vault/application/import-notes.ts`.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use regex_lite::Regex;

use crate::papers::js_regex::compile;
use crate::reader_analysis::lines::js_trim;
use crate::vault::page::normalize_title_key;

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
    fn import_file_extensions() {
        assert!(is_note_import_file("Note.MD"));
        assert!(is_note_import_file("vault.zip"));
        assert!(!is_note_import_file("image.png"));
        assert!(!is_note_import_file("notes.md.txt"));
    }
}
