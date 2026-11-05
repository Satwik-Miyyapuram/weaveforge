//! Golden, ported and property tests for `sync::git_policy` and `sync::git_remote`.
//! Goldens were printed by `packages/core/src/workspace/git-remote.ts` and
//! `git-sync-policy.ts` through `tests/goldens/sync-leaf.mjs`. Ported from
//! `packages/core/test/workspace/git-sync-policy.test.ts` and `git-remote.test.ts`.
//! The `NoOpWorkspaceGit` case in `git-remote.test.ts` needs the TypeScript git
//! port, which is not ported here, so it is not ported.

// Golden-reading helpers sit outside `#[test]`, where clippy.toml's test allowance stops.
#![allow(clippy::expect_used, clippy::panic)]

use std::collections::HashSet;

use proptest::prelude::*;
use serde_json::{Value, json};
use wf_core::sync::git_policy::{
    GIT_SYNC_IGNORED_EXTENSIONS, GIT_SYNC_MAX_FILE_BYTES, GitSyncDecision, GitSyncSkipReason,
    decide_git_sync_path, is_under_ignored_folder,
};
use wf_core::sync::git_remote::{
    DEFAULT_SYNC_BRANCH, GitPullResult, GitPushResult, GitRemoteUrlCheck, SYNC_AUTHOR,
    check_git_remote_url, describe_pull, describe_push, redact_secret,
};

const GOLDEN: &str = include_str!("goldens/sync-leaf.json");

const MB: f64 = 1024.0 * 1024.0;
const SMALL: f64 = 1024.0;

fn golden() -> Value {
    serde_json::from_str(GOLDEN).expect("sync-leaf.json parses")
}

fn cases<'a>(golden: &'a Value, section: &str) -> &'a [Value] {
    golden[section].as_array().expect(section).as_slice()
}

fn text(v: &Value) -> &str {
    v.as_str().expect("golden string")
}

fn check_json(check: &GitRemoteUrlCheck) -> Value {
    match check {
        GitRemoteUrlCheck::Accepted { url } => json!({ "ok": true, "url": url }),
        GitRemoteUrlCheck::Refused { reason } => json!({ "ok": false, "reason": reason }),
    }
}

fn decision_json(decision: GitSyncDecision) -> Value {
    match decision {
        GitSyncDecision::Include => json!({ "include": true }),
        GitSyncDecision::Skip(reason) => json!({ "include": false, "reason": reason.as_str() }),
    }
}

fn pull_from(v: &Value) -> GitPullResult {
    match text(&v["kind"]) {
        "up-to-date" => GitPullResult::UpToDate,
        "fast-forward" => GitPullResult::FastForward { oid: String::new() },
        "merged" => GitPullResult::Merged { oid: String::new() },
        "conflict" => GitPullResult::Conflict {
            files: v["files"]
                .as_array()
                .expect("files")
                .iter()
                .map(|f| text(f).to_owned())
                .collect(),
        },
        other => panic!("unknown pull kind {other}"),
    }
}

fn push_from(v: &Value) -> GitPushResult {
    match text(&v["kind"]) {
        "pushed" => GitPushResult::Pushed,
        "up-to-date" => GitPushResult::UpToDate,
        "rejected" => GitPushResult::Rejected {
            reason: text(&v["reason"]).to_owned(),
        },
        other => panic!("unknown push kind {other}"),
    }
}

fn decide(path: &str, size: f64) -> GitSyncDecision {
    decide_git_sync_path(path, size, GIT_SYNC_MAX_FILE_BYTES)
}

fn included(path: &str) -> bool {
    decide(path, SMALL) == GitSyncDecision::Include
}

fn reason_for(path: &str, size: f64) -> Option<GitSyncSkipReason> {
    match decide(path, size) {
        GitSyncDecision::Include => None,
        GitSyncDecision::Skip(reason) => Some(reason),
    }
}

#[test]
fn golden_urls_match_check_git_remote_url() {
    let golden = golden();
    for case in cases(&golden, "urls") {
        let got = check_json(&check_git_remote_url(case["raw"].as_str()));
        assert_eq!(got, case["out"], "case {}", case["raw"]);
    }
}

#[test]
fn golden_pulls_match_describe_pull() {
    let golden = golden();
    for case in cases(&golden, "pulls") {
        let got = describe_pull(&pull_from(&case["in"]));
        assert_eq!(got, text(&case["out"]), "case {}", case["in"]);
    }
}

#[test]
fn golden_pushes_match_describe_push() {
    let golden = golden();
    for case in cases(&golden, "pushes") {
        let got = describe_push(&push_from(&case["in"]));
        assert_eq!(got, text(&case["out"]), "case {}", case["in"]);
    }
}

#[test]
fn golden_redacts_match_redact_secret() {
    let golden = golden();
    for case in cases(&golden, "redacts") {
        let got = redact_secret(text(&case["text"]), case["secret"].as_str());
        assert_eq!(got, text(&case["out"]), "case {}", case["text"]);
    }
}

#[test]
fn golden_ignored_match_is_under_ignored_folder() {
    let golden = golden();
    for case in cases(&golden, "ignored") {
        let got = json!(is_under_ignored_folder(text(&case["path"])));
        assert_eq!(got, case["out"], "case {}", case["path"]);
    }
}

#[test]
fn golden_decide_matches_decide_git_sync_path() {
    let golden = golden();
    for case in cases(&golden, "decide") {
        // JSON has no NaN or Infinity, so the golden stores both as null; both are too large.
        let size = case["size"].as_f64().unwrap_or(f64::NAN);
        let got = decision_json(decide(text(&case["path"]), size));
        assert_eq!(got, case["out"], "case {} {}", case["path"], case["size"]);
    }
}

#[test]
fn the_size_cap_is_25_mb() {
    assert_eq!(GIT_SYNC_MAX_FILE_BYTES.to_bits(), (25.0 * MB).to_bits());
}

#[test]
fn ordinary_notes_latex_and_markdown_are_synced() {
    for path in [
        "notes/a.note.md",
        "report/main.tex",
        "papers/attention.paper.md",
        "logbook/2026-10-29.md",
    ] {
        assert!(included(path), "{path}");
    }
}

#[test]
fn generic_user_folder_names_are_synced() {
    for path in [
        "build/plan.md",
        "notes/out/x.html",
        "notes/caches/readme.md",
        "caches/thumb.png",
    ] {
        assert!(included(path), "{path}");
    }
}

#[test]
fn dependency_folders_are_ignored_at_any_depth() {
    assert_eq!(
        reason_for("node_modules/left-pad/index.js", SMALL),
        Some(GitSyncSkipReason::IgnoredDirectory)
    );
    assert_eq!(
        reason_for("notes/tools/node_modules/a.js", SMALL),
        Some(GitSyncSkipReason::IgnoredDirectory)
    );
}

#[test]
fn nested_git_directories_and_files_are_ignored() {
    for path in ["papers/sub/.git/config", "notes/.git", ".git/HEAD"] {
        assert_eq!(
            reason_for(path, SMALL),
            Some(GitSyncSkipReason::IgnoredDirectory),
            "{path}"
        );
    }
}

#[test]
fn build_outputs_and_framework_caches_are_ignored() {
    for path in [
        "dist/app.js",
        "apps/web/.next/cache/x.pack",
        ".cache/x",
        "notes/.cache/y",
    ] {
        assert_eq!(
            reason_for(path, SMALL),
            Some(GitSyncSkipReason::IgnoredDirectory),
            "{path}"
        );
    }
}

#[test]
fn pdf_cache_is_ignored() {
    assert_eq!(
        reason_for("pdf-cache/abc.bin", SMALL),
        Some(GitSyncSkipReason::IgnoredDirectory)
    );
    assert_eq!(
        reason_for("notes/pdf-cache/abc.bin", SMALL),
        Some(GitSyncSkipReason::IgnoredDirectory)
    );
}

#[test]
fn folder_names_are_matched_case_insensitively() {
    assert_eq!(
        reason_for("Node_Modules/a.js", SMALL),
        Some(GitSyncSkipReason::IgnoredDirectory)
    );
    assert_eq!(
        reason_for("DIST/app.js", SMALL),
        Some(GitSyncSkipReason::IgnoredDirectory)
    );
    assert_eq!(
        reason_for("notes/.GIT/config", SMALL),
        Some(GitSyncSkipReason::IgnoredDirectory)
    );
}

#[test]
fn file_names_are_matched_case_insensitively() {
    assert_eq!(
        reason_for("Desktop.ini", SMALL),
        Some(GitSyncSkipReason::IgnoredFile)
    );
    assert_eq!(
        reason_for("notes/DESKTOP.INI", SMALL),
        Some(GitSyncSkipReason::IgnoredFile)
    );
}

#[test]
fn latex_build_byproducts_are_ignored_by_extension() {
    for ext in GIT_SYNC_IGNORED_EXTENSIONS {
        assert_eq!(
            reason_for(&format!("report/main{ext}"), SMALL),
            Some(GitSyncSkipReason::IgnoredFile),
            "{ext}"
        );
    }
    assert!(included("report/main.tex"));
}

#[test]
fn root_weaveforge_folder_is_never_synced() {
    assert_eq!(
        reason_for(".weaveforge/workspace.db", SMALL),
        Some(GitSyncSkipReason::IgnoredDirectory)
    );
    assert_eq!(
        reason_for("/.weaveforge/workspace.db", SMALL),
        Some(GitSyncSkipReason::IgnoredDirectory)
    );
}

#[test]
fn nested_weaveforge_folder_is_left_to_the_size_cap() {
    assert!(included("notes/.weaveforge/readme.md"));
}

#[test]
fn desktop_ini_is_ignored_wherever_it_appears() {
    assert_eq!(
        reason_for("desktop.ini", SMALL),
        Some(GitSyncSkipReason::IgnoredFile)
    );
    assert_eq!(
        reason_for("notes/desktop.ini", SMALL),
        Some(GitSyncSkipReason::IgnoredFile)
    );
}

#[test]
fn a_file_named_like_an_ignored_folder_is_synced() {
    assert!(included("notes/dist"));
    assert!(included("notes/node_modules"));
    assert_eq!(
        reason_for("notes/dist/x.md", SMALL),
        Some(GitSyncSkipReason::IgnoredDirectory)
    );
}

#[test]
fn backslash_paths_match_slash_paths() {
    assert_eq!(
        reason_for("notes\\node_modules\\a.md", SMALL),
        Some(GitSyncSkipReason::IgnoredDirectory)
    );
    assert_eq!(
        reason_for("notes\\.git\\config", SMALL),
        Some(GitSyncSkipReason::IgnoredDirectory)
    );
    assert!(included("notes\\a.md"));
}

#[test]
fn leading_slash_or_dot_slash_does_not_hide_an_ignored_folder() {
    assert_eq!(
        reason_for("/node_modules/a.js", SMALL),
        Some(GitSyncSkipReason::IgnoredDirectory)
    );
    assert_eq!(
        reason_for("./dist/a.js", SMALL),
        Some(GitSyncSkipReason::IgnoredDirectory)
    );
}

#[test]
fn empty_or_dot_path_is_an_invalid_path() {
    for path in ["", ".", "./"] {
        assert_eq!(
            reason_for(path, SMALL),
            Some(GitSyncSkipReason::InvalidPath),
            "{path:?}"
        );
    }
}

#[test]
fn exactly_the_cap_is_kept_and_one_byte_over_is_too_large() {
    assert_eq!(
        decide("papers/scan.pdf", GIT_SYNC_MAX_FILE_BYTES),
        GitSyncDecision::Include
    );
    assert_eq!(
        reason_for("papers/scan.pdf", GIT_SYNC_MAX_FILE_BYTES + 1.0),
        Some(GitSyncSkipReason::TooLarge)
    );
}

#[test]
fn a_cap_can_be_passed_in() {
    assert_eq!(
        decide_git_sync_path("notes/a.md", 11.0, 10.0),
        GitSyncDecision::Skip(GitSyncSkipReason::TooLarge)
    );
    assert_eq!(
        decide_git_sync_path("notes/a.md", 10.0, 10.0),
        GitSyncDecision::Include
    );
}

#[test]
fn an_empty_file_is_kept() {
    assert!(decide("notes/empty.md", 0.0) == GitSyncDecision::Include);
}

#[test]
fn negative_or_non_finite_size_is_skipped_as_too_large() {
    assert_eq!(
        reason_for("notes/a.md", -1.0),
        Some(GitSyncSkipReason::TooLarge)
    );
    assert_eq!(
        reason_for("notes/a.md", f64::NAN),
        Some(GitSyncSkipReason::TooLarge)
    );
    assert_eq!(
        reason_for("notes/a.md", f64::INFINITY),
        Some(GitSyncSkipReason::TooLarge)
    );
}

#[test]
fn ignore_rules_win_over_size() {
    assert_eq!(
        reason_for("node_modules/big.bin", 100.0 * MB),
        Some(GitSyncSkipReason::IgnoredDirectory)
    );
}

#[test]
fn is_under_ignored_folder_is_true_only_below_an_ignored_folder() {
    assert!(is_under_ignored_folder("node_modules/left-pad/index.js"));
    assert!(is_under_ignored_folder("node_modules/left-pad"));
    assert!(!is_under_ignored_folder("node_modules"));
    assert!(!is_under_ignored_folder("notes/dist"));
    assert!(!is_under_ignored_folder("notes/a.md"));
    assert!(is_under_ignored_folder(".weaveforge/x.db"));
}

#[test]
fn an_https_remote_url_is_accepted_and_normalised() {
    assert_eq!(
        check_git_remote_url(Some("  https://github.com/me/notes.git ")),
        GitRemoteUrlCheck::Accepted {
            url: "https://github.com/me/notes.git".to_owned()
        }
    );
}

#[test]
fn non_https_credentialed_empty_or_path_less_remote_urls_are_refused() {
    for raw in [
        Some(""),
        Some("   "),
        None,
        Some("not a url"),
        Some("http://github.com/me/notes.git"),
        Some("git@github.com:me/notes.git"),
        Some("file:///C:/repos/notes"),
        Some("ssh://git@github.com/me/notes.git"),
        Some("https://me:ghp_secret@github.com/me/notes.git"),
        Some("https://ghp_secret@github.com/me/notes.git"),
        Some("https://github.com"),
        Some("https://github.com/"),
    ] {
        let result = check_git_remote_url(raw);
        assert!(
            matches!(result, GitRemoteUrlCheck::Refused { .. }),
            "expected {raw:?} to be refused"
        );
    }
}

#[test]
fn a_token_is_never_echoed_back_in_the_refusal() {
    let result = check_git_remote_url(Some("https://me:ghp_secret@github.com/me/notes.git"));
    assert!(matches!(result, GitRemoteUrlCheck::Refused { .. }));
    assert!(!format!("{result:?}").contains("ghp_secret"));
}

#[test]
fn redact_secret_removes_every_occurrence_and_leaves_text_alone_without_one() {
    assert_eq!(
        redact_secret("auth abc failed for abc", Some("abc")),
        "auth *** failed for ***"
    );
    assert_eq!(redact_secret("nothing here", None), "nothing here");
    assert_eq!(redact_secret("nothing here", Some("")), "nothing here");
}

#[test]
fn pull_and_push_outcomes_read_as_one_sentence() {
    assert_eq!(
        describe_pull(&GitPullResult::UpToDate),
        "Already up to date."
    );
    let many = describe_pull(&GitPullResult::Conflict {
        files: ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"]
            .map(str::to_owned)
            .to_vec(),
    });
    assert!(many.contains("6 files"), "{many}");
    assert!(many.contains("a.md, b.md, c.md, d.md, e.md, …"), "{many}");
    assert!(many.contains("left as they were"), "{many}");
    let one = describe_pull(&GitPullResult::Conflict {
        files: vec!["a.md".to_owned()],
    });
    assert!(one.contains("1 file changed"), "{one}");
    assert_eq!(
        describe_push(&GitPushResult::Rejected {
            reason: "pull first".to_owned()
        }),
        "Not pushed: pull first"
    );
}

#[test]
fn sync_branch_and_author_are_the_fixed_constants() {
    assert_eq!(DEFAULT_SYNC_BRANCH, "main");
    assert_eq!(SYNC_AUTHOR, ("WeaveForge", "sync@weaveforge.local"));
}

fn distinct_char_secret() -> impl Strategy<Value = String> {
    "[a-z]{3,6}".prop_filter("no repeated character", |s| {
        let mut seen = HashSet::new();
        s.chars().all(|c| seen.insert(c))
    })
}

proptest! {
    #![proptest_config(ProptestConfig::default())]

    #[test]
    fn redacted_text_never_contains_the_secret(
        secret in distinct_char_secret(),
        pre in "[a-z ]{0,20}",
        mid in "[a-z ]{0,20}",
        post in "[a-z ]{0,20}",
    ) {
        let text = format!("{pre}{secret}{mid}{secret}{post}");
        let out = redact_secret(&text, Some(&secret));
        prop_assert!(!out.contains(&secret), "{out}");
    }
}
