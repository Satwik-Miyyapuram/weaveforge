//! Fuzzes the pure wf-core sync parsers on arbitrary UTF-8 input.
//!
//! Fuzzed (each result discarded; the goal is no panic or overflow):
//! - `sync::frontmatter::read_frontmatter`
//! - `sync::deserialize::parse_workspace_file` (path = first line, content = rest)
//! - `sync::instant::parse_instant`
//! - `sync::text_diff::has_conflict_markers`, `diff_body`, `write_conflict_markers`
//!   (input split into three parts at NUL bytes)
//! - `sync::git_remote::check_git_remote_url`
//! - `sync::markdown_image::normalize_markdown_image_syntax`, `image_paths_in_body`
//! - `sync::blob_links::to_relative_blob_links`
//! - `sync::ink_note::is_ink_note_body`, `read_ink_note_body`
//! - `workspace::safe_workspace_path` (idempotence asserted on accepted paths)

#![no_main]

use libfuzzer_sys::fuzz_target;
use wf_core::sync::blob_links::to_relative_blob_links;
use wf_core::sync::deserialize::parse_workspace_file;
use wf_core::sync::frontmatter::read_frontmatter;
use wf_core::sync::git_remote::check_git_remote_url;
use wf_core::sync::ink_note::{is_ink_note_body, read_ink_note_body};
use wf_core::sync::instant::parse_instant;
use wf_core::sync::markdown_image::{image_paths_in_body, normalize_markdown_image_syntax};
use wf_core::sync::text_diff::{diff_body, has_conflict_markers, write_conflict_markers};
use wf_core::workspace::safe_workspace_path;

fuzz_target!(|data: &[u8]| {
    let Ok(text) = std::str::from_utf8(data) else {
        return;
    };

    let _ = read_frontmatter(text);

    let (first_line, rest) = text.split_once('\n').unwrap_or((text, ""));
    let _ = parse_workspace_file("notes/x.note.md", text);
    let _ = parse_workspace_file(first_line, rest);

    let _ = parse_instant(text);

    let mut parts = text.split('\u{0}');
    let a = parts.next().unwrap_or("");
    let b = parts.next().unwrap_or("");
    let _ = has_conflict_markers(text);
    let _ = diff_body(a, b);
    let _ = write_conflict_markers(a, b);

    let _ = check_git_remote_url(Some(text));

    let _ = normalize_markdown_image_syntax(text);
    let _ = image_paths_in_body(text, "assets/", |s: &str| s.to_owned());
    let _ = to_relative_blob_links(text, "notes/x.note.md");

    let _ = is_ink_note_body(text);
    let _ = read_ink_note_body(text);

    if let Ok(path) = safe_workspace_path(text) {
        assert_eq!(safe_workspace_path(&path).ok(), Some(path.clone()));
    }
});
