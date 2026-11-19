//! Tests for `wf_core::index`: duplicates, conflict copies, renames, links, relations and read-only files.

use wf_core::index::scan::{entry_from_file, index_files, relations_from_json, wiki_links};
use wf_core::index::{IndexStore, Relation};
use wf_core::sync::frontmatter::FORMAT_VERSION;

/// Helpers live here so `cfg(test)` covers their unwraps, which clippy would otherwise flag.
#[cfg(test)]
mod support {
    /// A note with a valid frontmatter block.
    pub fn note(id: &str, title: &str, body: &str) -> String {
        format!(
            "---\nweaveforge-id: {id}\nweaveforge-type: vault_page\ntitle: {title}\n---\n\n{body}\n"
        )
    }

    /// A note with an inline tag list.
    pub fn tagged(id: &str, tags: &str) -> String {
        format!(
            "---\nweaveforge-id: {id}\nweaveforge-type: vault_page\ntags: [{tags}]\n---\n\nbody\n"
        )
    }

    /// The first entry for `id` in `store`, failing the test if absent.
    pub fn id_of(store: &super::IndexStore, path: &str) -> String {
        store.by_path(path).expect("entry at path").id.clone()
    }
}

use support::{id_of, note, tagged};

#[test]
fn duplicate_id_both_badged() {
    let a = note("n1", "A", "one");
    let b = note("n1", "B", "two");
    let mut store = index_files([("p/notes/a.md", a.as_str()), ("p/notes/b.md", b.as_str())]);

    assert!(store.by_path("p/notes/a.md").is_some_and(|e| e.duplicate));
    assert!(store.by_path("p/notes/b.md").is_some_and(|e| e.duplicate));
    assert_eq!(store.duplicates().len(), 2);

    let _ = store.remove_path("p/notes/b.md");
    assert!(store.by_path("p/notes/a.md").is_some_and(|e| !e.duplicate));
    assert!(store.duplicates().is_empty());
}

#[test]
fn conflict_copy_not_a_duplicate() {
    let a = note("n1", "A", "one");
    let copy = "---\nweaveforge-id: n1\nweaveforge-type: vault_page\ntitle: A\nconflict_of: n1\n---\n\ntwo\n";
    let store = index_files([
        ("p/notes/a.md", a.as_str()),
        ("p/notes/a.conflict-20261118T101502Z.md", copy),
    ]);

    assert!(store.by_path("p/notes/a.md").is_some_and(|e| !e.duplicate));
    assert!(store.duplicates().is_empty());
}

#[test]
fn file_rename_keeps_id() {
    let text = note("n1", "A", "one");
    let mut store = index_files([("p/notes/a.md", text.as_str())]);

    assert!(store.rename_path("p/notes/a.md", "p/notes/renamed.md"));
    assert!(!store.rename_path("p/notes/missing.md", "p/notes/x.md"));
    assert_eq!(
        store.get("n1").map(|e| e.path.as_str()),
        Some("p/notes/renamed.md")
    );
    assert_eq!(id_of(&store, "p/notes/renamed.md"), "n1");
    assert!(store.by_path("p/notes/a.md").is_none());

    let fresh = entry_from_file("p/notes/renamed.md", &text).map(|e| e.id);
    assert_eq!(fresh.as_deref(), Some("n1"));
}

#[test]
fn wiki_links_and_backlinks() {
    let body = "see [[n1]] and [[n1|again]] and [[ x ]]";
    assert_eq!(wiki_links(body), vec!["n1".to_owned(), "x".to_owned()]);

    let n1 = note("n1", "One", "base");
    let n2 = note("n2", "Two", body);
    let store = index_files([
        ("p/notes/n1.md", n1.as_str()),
        ("p/notes/n2.md", n2.as_str()),
    ]);

    assert_eq!(
        store.by_path("p/notes/n2.md").map(|e| e.links.clone()),
        Some(vec!["n1".to_owned(), "x".to_owned()])
    );
    assert!(store.backlinks("n1").iter().any(|e| e.id == "n2"));
}

#[test]
fn list_by_kind_and_project() {
    let a = note("a", "A", "x");
    let b = note("b", "B", "x");
    let c = "---\nweaveforge-id: c\nweaveforge-type: paper\ntitle: C\n---\n\nx\n";
    let store = index_files([
        ("p/notes/a.md", a.as_str()),
        ("q/notes/b.md", b.as_str()),
        ("p/papers/c.md", c),
    ]);

    assert_eq!(store.list("", None).len(), 3);
    assert_eq!(store.list("*", Some("p")).len(), 2);
    let papers: Vec<&str> = store
        .list("paper", None)
        .iter()
        .map(|e| e.id.as_str())
        .collect();
    assert_eq!(papers, vec!["c"]);
    let q_notes: Vec<&str> = store
        .list("vault_page", Some("q"))
        .iter()
        .map(|e| e.id.as_str())
        .collect();
    assert_eq!(q_notes, vec!["b"]);
}

#[test]
fn tag_counts_counts_tags() {
    let a = tagged("a", "alpha, beta");
    let b = tagged("b", "beta");
    let store = index_files([("p/notes/a.md", a.as_str()), ("p/notes/b.md", b.as_str())]);

    let counts = store.tag_counts();
    assert_eq!(counts.get("alpha"), Some(&1));
    assert_eq!(counts.get("beta"), Some(&2));
    assert_eq!(counts.len(), 2);
}

#[test]
fn relations_read_from_json() {
    let json = r#"[
        {"source_id":"a","target_id":"b","relation_type":"cites"},
        {"source_id":"b","target_id":"c","type":"supports"},
        {"source_id":"x"}
    ]"#;
    let rows = relations_from_json(json);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].relation_type, "cites");
    assert_eq!(rows[1].relation_type, "supports");

    let wrapped = r#"{"relations":[{"source_id":"a","target_id":"b","type":"cites"}]}"#;
    assert_eq!(relations_from_json(wrapped).len(), 1);
    assert!(relations_from_json("not json").is_empty());

    let store: IndexStore = index_files([("p/.weaveforge/relations.json", json)]);
    assert_eq!(store.relations_of("b").len(), 2);
    let first: Relation = rows[0].clone();
    assert_eq!(first.target_id, "b");
}

#[test]
fn wf4_entry_read_only() {
    let text = format!(
        "---\nweaveforge-id: n1\nweaveforge-type: vault_page\ntitle: A\nwf: {}\n---\n\nbody\n",
        FORMAT_VERSION + 1
    );
    let entry = entry_from_file("p/notes/a.md", &text).expect("an entry");

    assert!(entry.read_only);
    assert_eq!(entry.wf, Some(FORMAT_VERSION + 1));
}
