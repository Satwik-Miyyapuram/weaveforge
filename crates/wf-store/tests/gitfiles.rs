//! Integration tests for `wf_store::files::gitfiles`: append-only `.gitignore` and `.gitattributes`.

#[cfg(test)]
mod common;

use std::fs;

use common::TempDir;
use wf_store::files::gitfiles::{
    GITATTRIBUTES_LINES, GITIGNORE_LINES, GitFilesReport, ensure_gitfiles,
};

/// Each line followed by `\n`, the form WeaveForge appends.
fn block(lines: &[&str]) -> String {
    lines.iter().map(|line| format!("{line}\n")).collect()
}

#[test]
fn gitfiles_appends_missing_lines_only() {
    let dir = TempDir::new();
    let existing = "node_modules/\n.weaveforge/cache/\n";
    fs::write(dir.path().join(".gitignore"), existing).unwrap();

    let report = ensure_gitfiles(dir.path()).unwrap();
    assert_eq!(report.gitignore_added, 6);
    let text = fs::read_to_string(dir.path().join(".gitignore")).unwrap();
    assert!(text.starts_with(existing));
    for line in GITIGNORE_LINES {
        assert_eq!(text.lines().filter(|l| l == line).count(), 1, "{line}");
    }

    let again = ensure_gitfiles(dir.path()).unwrap();
    assert_eq!(again, GitFilesReport::default());
    assert_eq!(
        fs::read_to_string(dir.path().join(".gitignore")).unwrap(),
        text
    );
}

#[test]
fn gitfiles_created_when_absent() {
    let dir = TempDir::new();
    let report = ensure_gitfiles(dir.path()).unwrap();
    assert_eq!(report.gitignore_added, GITIGNORE_LINES.len());
    assert_eq!(report.gitattributes_added, GITATTRIBUTES_LINES.len());
    assert_eq!(
        fs::read_to_string(dir.path().join(".gitignore")).unwrap(),
        block(GITIGNORE_LINES)
    );
    assert_eq!(
        fs::read_to_string(dir.path().join(".gitattributes")).unwrap(),
        block(GITATTRIBUTES_LINES)
    );
}

#[test]
fn gitfiles_no_trailing_newline() {
    let dir = TempDir::new();
    fs::write(dir.path().join(".gitignore"), "a").unwrap();

    let _ = ensure_gitfiles(dir.path()).unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join(".gitignore")).unwrap(),
        format!("a\n{}", block(GITIGNORE_LINES))
    );
}

/// A link named `.gitignore`, when this machine lets the test make one.
fn link_file(target: &std::path::Path, link: &std::path::Path) -> bool {
    #[cfg(unix)]
    return std::os::unix::fs::symlink(target, link).is_ok();
    #[cfg(windows)]
    return std::os::windows::fs::symlink_file(target, link).is_ok();
}

#[test]
fn f97_p2_9_gitfiles_never_write_through_a_link() {
    let dir = TempDir::new();
    let outside = TempDir::new();
    let target = outside.path().join("victim.txt");
    fs::write(&target, "keep\n").unwrap();
    if !link_file(&target, &dir.path().join(".gitignore")) {
        eprintln!("skipped: this machine cannot make a file link");
        return;
    }
    assert!(ensure_gitfiles(dir.path()).is_err());
    assert_eq!(fs::read_to_string(&target).unwrap(), "keep\n");
}
