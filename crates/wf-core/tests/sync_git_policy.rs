//! Table, ported and property tests for `sync::git_policy` and `sync::git_remote`.
//! The tables keep every case the old TypeScript-printed golden of
//! `packages/core/src/workspace/parts-2.ts` and `git-sync-policy.ts` covered.
//! Ported from `packages/core/test/workspace/git-sync-policy.test.ts` and
//! `git-remote.test.ts`. The `NoOpWorkspaceGit` case in `git-remote.test.ts`
//! needs the TypeScript git port, which is not ported here, so it is not ported.

use std::collections::HashSet;

use proptest::prelude::*;
use wf_core::sync::git_policy::{
    GIT_SYNC_IGNORED_EXTENSIONS, GIT_SYNC_MAX_FILE_BYTES, GitSyncDecision, GitSyncSkipReason,
    decide_git_sync_path, is_under_ignored_folder,
};
use wf_core::sync::git_remote::{
    DEFAULT_SYNC_BRANCH, GitPullResult, GitPushResult, GitRemoteUrlCheck, SYNC_AUTHOR,
    check_git_remote_url, describe_pull, describe_push, redact_secret,
};

const MB: f64 = 1024.0 * 1024.0;
const SMALL: f64 = 1024.0;

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

const NEEDS_PATH: &str =
    "The URL needs the repository path, e.g. https://github.com/you/notes.git.";
const NO_TOKEN: &str = "Leave the token out of the URL; put it in the token field.";
const HTTPS_ONLY: &str = "Only https:// remotes are supported.";
const NOT_URL: &str = "That is not a URL.";
const ENTER_URL: &str = "Enter the remote's https URL.";

/// Raw input, then the normalised URL or the refusal reason. `None` stands for
/// any non-string the TypeScript side was given (null, a number, an object).
#[test]
fn url_cases() {
    let cases: [(Option<&str>, Result<&str, &'static str>); 26] = [
        (
            Some("https://github.com/you/notes.git"),
            Ok("https://github.com/you/notes.git"),
        ),
        (
            Some("  https://github.com/you/notes.git  "),
            Ok("https://github.com/you/notes.git"),
        ),
        (
            Some("HTTPS://GitHub.com/You/Notes.git"),
            Ok("https://github.com/You/Notes.git"),
        ),
        (Some("https://github.com"), Err(NEEDS_PATH)),
        (Some("https://github.com/"), Err(NEEDS_PATH)),
        (Some("https://user@github.com/a/b.git"), Err(NO_TOKEN)),
        (Some("https://user:tok@github.com/a/b.git"), Err(NO_TOKEN)),
        (Some("https://:tok@github.com/a/b.git"), Err(NO_TOKEN)),
        (Some("http://github.com/a/b.git"), Err(HTTPS_ONLY)),
        (Some("ssh://git@github.com/a/b.git"), Err(HTTPS_ONLY)),
        (Some("git@github.com:a/b.git"), Err(NOT_URL)),
        (Some("github.com/a/b"), Err(NOT_URL)),
        (Some(""), Err(ENTER_URL)),
        (Some("   "), Err(ENTER_URL)),
        (Some("https://exa mple.com/a"), Err(NOT_URL)),
        (
            Some("https://example.com:443/a"),
            Ok("https://example.com/a"),
        ),
        (
            Some("https://example.com:8443/a/../b"),
            Ok("https://example.com:8443/b"),
        ),
        (
            Some("https://example.com/a b"),
            Ok("https://example.com/a%20b"),
        ),
        (
            Some("https://例え.jp/repo"),
            Ok("https://xn--r8jz45g.jp/repo"),
        ),
        (
            Some("https://example.com/a?x=1#frag"),
            Ok("https://example.com/a?x=1#frag"),
        ),
        (Some("https://[::1]/a"), Ok("https://[::1]/a")),
        (
            Some("https://example.com/%7Euser/r"),
            Ok("https://example.com/%7Euser/r"),
        ),
        (Some("https:/example.com/a"), Ok("https://example.com/a")),
        (Some("https:example.com/a"), Ok("https://example.com/a")),
        (
            Some("https://example.com\\a\\b"),
            Ok("https://example.com/a/b"),
        ),
        (None, Err(ENTER_URL)),
    ];
    for (raw, want) in cases {
        let want = match want {
            Ok(url) => GitRemoteUrlCheck::Accepted {
                url: url.to_owned(),
            },
            Err(reason) => GitRemoteUrlCheck::Refused { reason },
        };
        assert_eq!(check_git_remote_url(raw), want, "case {raw:?}");
    }
}

fn conflict(files: &[&str]) -> GitPullResult {
    GitPullResult::Conflict {
        files: files.iter().map(|f| (*f).to_owned()).collect(),
    }
}

/// A conflict lists at most five files, then an ellipsis.
#[test]
fn pull_cases() {
    let cases = [
        (GitPullResult::UpToDate, "Already up to date."),
        (
            GitPullResult::FastForward { oid: String::new() },
            "Pulled the remote's changes.",
        ),
        (
            GitPullResult::Merged { oid: String::new() },
            "Merged the remote's changes with yours.",
        ),
        (
            conflict(&["a.md"]),
            "Not pulled: 1 file changed on both sides (a.md). Your files were left as they were.",
        ),
        (
            conflict(&["a.md", "b.md"]),
            "Not pulled: 2 files changed on both sides (a.md, b.md). Your files were left as they were.",
        ),
        (
            conflict(&["1", "2", "3", "4", "5"]),
            "Not pulled: 5 files changed on both sides (1, 2, 3, 4, 5). Your files were left as they were.",
        ),
        (
            conflict(&["1", "2", "3", "4", "5", "6"]),
            "Not pulled: 6 files changed on both sides (1, 2, 3, 4, 5, …). Your files were left as they were.",
        ),
    ];
    for (result, want) in cases {
        assert_eq!(describe_pull(&result), want, "case {result:?}");
    }
}

#[test]
fn push_cases() {
    let cases = [
        (GitPushResult::Pushed, "Pushed."),
        (GitPushResult::UpToDate, "Nothing to push."),
        (
            GitPushResult::Rejected {
                reason: "non-fast-forward".to_owned(),
            },
            "Not pushed: non-fast-forward",
        ),
    ];
    for (result, want) in cases {
        assert_eq!(describe_push(&result), want, "case {result:?}");
    }
}

/// Text, secret, redacted text. A missing or empty secret leaves the text alone.
#[test]
fn redact_cases() {
    let cases = [
        ("token abc in abc", Some("abc"), "token *** in ***"),
        ("nothing", None, "nothing"),
        ("nothing", Some(""), "nothing"),
        ("aaaa", Some("aa"), "******"),
    ];
    for (text, secret, want) in cases {
        assert_eq!(
            redact_secret(text, secret),
            want,
            "case {text:?} {secret:?}"
        );
    }
}

/// Path, whether it sits under an ignored folder, and the skip reason at any
/// size (`None` when the path itself is synced). Each path is then decided at
/// seven sizes: a skipped path skips at all of them; a synced path is included
/// up to the 25 MB cap and too large above it or when the size is negative,
/// NaN or infinite.
#[test]
fn path_cases() {
    use GitSyncSkipReason::*;
    let cases: [(&str, bool, Option<GitSyncSkipReason>); 18] = [
        ("notes/a.md", false, None),
        (".weaveforge/state.json", true, Some(IgnoredDirectory)),
        ("node_modules/x/y.js", true, Some(IgnoredDirectory)),
        (".git/config", true, Some(IgnoredDirectory)),
        ("a/.trash/b.md", false, None),
        ("paper/main.aux", false, Some(IgnoredFile)),
        ("paper/main.synctex.gz", false, Some(IgnoredFile)),
        ("desktop.ini", false, Some(IgnoredFile)),
        ("sub/Desktop.ini", false, Some(IgnoredFile)),
        ("big.bin", false, None),
        ("", false, Some(InvalidPath)),
        ("./.", false, Some(InvalidPath)),
        ("notes/.weaveforge/x.md", false, None),
        ("notes\\dist\\x.md", true, Some(IgnoredDirectory)),
        ("notes/dist", false, None),
        ("a/.git", false, Some(IgnoredDirectory)),
        ("A/NODE_MODULES/b", true, Some(IgnoredDirectory)),
        ("./notes//a.md", false, None),
    ];
    let sizes = [
        (0.0, true),
        (SMALL, true),
        (25.0 * MB, true),
        (25.0 * MB + 1.0, false),
        (-1.0, false),
        (f64::NAN, false),
        (f64::INFINITY, false),
    ];
    for (path, under_ignored, skip) in cases {
        assert_eq!(
            is_under_ignored_folder(path),
            under_ignored,
            "ignored {path:?}"
        );
        for (size, fits) in sizes {
            let want = match skip {
                Some(reason) => GitSyncDecision::Skip(reason),
                None if fits => GitSyncDecision::Include,
                None => GitSyncDecision::Skip(TooLarge),
            };
            assert_eq!(decide(path, size), want, "decide {path:?} at {size}");
        }
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
fn project_mirror_manifest_is_this_machines_and_never_synced() {
    assert_eq!(
        reason_for("thesis/.weaveforge/mirror.json", SMALL),
        Some(GitSyncSkipReason::IgnoredFile)
    );
    assert_eq!(
        reason_for("Thesis\\.WeaveForge\\Mirror.json", SMALL),
        Some(GitSyncSkipReason::IgnoredFile)
    );
    // The other project records travel with the project.
    assert!(included("thesis/.weaveforge/tags.json"));
    assert!(included("thesis/mirror.json"));
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
fn only_the_root_settings_json_is_synced_out_of_the_meta_folder() {
    assert!(!is_under_ignored_folder(".weaveforge/settings.json"));
    assert!(!is_under_ignored_folder(".WeaveForge\\Settings.JSON"));
    assert!(is_under_ignored_folder(".weaveforge/device.json"));
    assert!(is_under_ignored_folder(".weaveforge/settings.json/extra"));
    assert!(is_under_ignored_folder(".weaveforge/sub/settings.json"));
    // A nested `.weaveforge` folder is not the database folder and is not ignored by this rule.
    assert!(!is_under_ignored_folder("notes/.weaveforge/settings.json"));
    assert_eq!(
        decide_git_sync_path(".weaveforge/settings.json", 10.0, MB),
        GitSyncDecision::Include
    );
    assert_eq!(
        decide_git_sync_path(".weaveforge/device.json", 10.0, MB),
        GitSyncDecision::Skip(GitSyncSkipReason::IgnoredDirectory)
    );
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
