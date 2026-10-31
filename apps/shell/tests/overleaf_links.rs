#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::print_stderr,
    missing_docs
)]
//! Tests for the Overleaf link list: the folder rules, the link rules, the stored links and the list, link and unlink actions.
mod common;

use std::path::{Path, PathBuf};

use common::TempDir;
use serde_json::json;
use weaveforge_shell::git::GitQueue;
use weaveforge_shell::overleaf_links::{
    ALREADY_LINKED, BAD_FOLDER, BAD_PROJECT, FOLDER_TAKEN, NO_TOKEN, NOT_AN_ACTION, NOT_LINKED,
    OUTSIDE, OVERLEAF_BRANCH, OVERLEAF_GIT_URL, OverleafDeps, OverleafGit, OverleafLink,
    OverleafSyncReply, apply_link_action, check_link_folder, inside_vault, overleaf_git_dir,
    overleaf_sync_with, parse_links,
};
use weaveforge_shell::prefs::{PrefValue, Prefs};
use weaveforge_shell::secrets::Secrets;
use weaveforge_shell::vault::{NO_ROOT, VaultState};
use weaveforge_shell::vault_sync::{SyncPull, SyncPush, SyncStatus};

const ID: &str = "64f0c0ffee0123456789abcd";
const OTHER: &str = "64f0c0ffee0123456789abce";
const SERVICE: &str = "org.weaveforge.test";
const TOKEN: &str = "olp_token";

fn link(project_id: &str, folder: &str) -> OverleafLink {
    OverleafLink {
        project_id: project_id.to_owned(),
        folder: folder.to_owned(),
    }
}

fn prefs_in(dir: &TempDir) -> Prefs {
    Prefs::new(dir.path().join("preferences.json"))
}

fn fresh_secrets(token: Option<&str>) -> Secrets {
    let store = keyring_core::mock::Store::new().expect("mock store");
    let secrets = Secrets::new(Some(store), SERVICE);
    if let Some(token) = token {
        secrets.write("overleaf-token", token).expect("token");
    }
    secrets
}

fn vault_at(dir: &Path) -> VaultState {
    let vault = VaultState::new();
    let _ = vault.lock().choose(Some(dir)).expect("root");
    vault
}

/// Runs with a throwaway git store and a remote that does not exist, so
/// nothing a test does lands in the working directory.
async fn run(
    prefs: &Prefs,
    secrets: &Secrets,
    vault: &VaultState,
    action: &str,
    project: Option<&str>,
    folder: Option<&str>,
) -> Result<OverleafSyncReply, String> {
    let store = TempDir::new();
    let git = OverleafGit {
        store: store.path().join("overleaf-git"),
        remote_base: "unused-remote/".to_owned(),
    };
    run_with(prefs, secrets, vault, &git, action, project, folder).await
}

async fn run_with(
    prefs: &Prefs,
    secrets: &Secrets,
    vault: &VaultState,
    git: &OverleafGit,
    action: &str,
    project: Option<&str>,
    folder: Option<&str>,
) -> Result<OverleafSyncReply, String> {
    let queue = GitQueue::default();
    let deps = OverleafDeps {
        prefs,
        secrets,
        vault,
        queue: &queue,
    };
    overleaf_sync_with(
        &deps,
        git,
        action.to_owned(),
        project.map(str::to_owned),
        folder.map(str::to_owned),
    )
    .await
}

/// A bare repo at `<remote>/<id>` whose `master` has one commit with `main.tex`.
fn bare_remote_with_main(remote: &Path, id: &str) -> PathBuf {
    let bare = remote.join(id);
    let repo = git2::Repository::init_bare(&bare).expect("bare");
    let blob = repo.blob(b"\\documentclass{article}\n").expect("blob");
    let mut builder = repo.treebuilder(None).expect("builder");
    let _ = builder.insert("main.tex", blob, 0o100_644).expect("insert");
    let tree = repo
        .find_tree(builder.write().expect("tree"))
        .expect("find tree");
    let sig = git2::Signature::now("WeaveForge", "test@example.com").expect("sig");
    let _ = repo
        .commit(Some("refs/heads/master"), &sig, &sig, "init", &tree, &[])
        .expect("commit");
    bare
}

/// How many commits the bare repo's `master` holds.
fn master_commits(bare: &Path) -> usize {
    let repo = git2::Repository::open_bare(bare).expect("open bare");
    let mut walk = repo.revwalk().expect("revwalk");
    walk.push_ref("refs/heads/master").expect("master");
    walk.count()
}

#[cfg(unix)]
fn make_dir_link(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn make_dir_link(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(target, link)
}

#[test]
fn link_folders_are_relative_forward_slashes_and_inside_the_vault() {
    for ok in ["Overleaf/thesis", "papers/2026 draft", "a", "a/b"] {
        assert_eq!(check_link_folder(ok).unwrap(), ok);
    }
    assert_eq!(
        check_link_folder("  Overleaf/thesis/ ").unwrap(),
        "Overleaf/thesis"
    );
    for bad in [
        "",
        "/",
        "/abs",
        "C:/x",
        "C:\\x",
        "a\\b",
        "../x",
        "../out",
        "a/../../b",
        "a/./b",
        ".",
        "a//b",
        ".weaveforge/x",
        "x/.git",
        ".git",
    ] {
        assert_eq!(check_link_folder(bad).unwrap_err(), BAD_FOLDER, "{bad}");
    }
}

#[test]
fn stored_links_are_read_back_defensively() {
    assert_eq!(parse_links(&json!(null)), Vec::new());
    assert_eq!(parse_links(&json!("not json")), Vec::new());
    assert_eq!(
        parse_links(&json!({"projectId": ID, "folder": "Overleaf/a"})),
        Vec::new()
    );
    let stored = json!([
        {"projectId": ID, "folder": "Overleaf/a"},
        {"projectId": "bad id!", "folder": "x"},
        {"folder": "y"},
        {"projectId": 7, "folder": "z"},
        {"projectId": OTHER, "folder": 3},
        {"projectId": OTHER, "folder": "../up"},
        "not an object",
        null
    ]);
    assert_eq!(parse_links(&stored), vec![link(ID, "Overleaf/a")]);
}

#[test]
fn stored_folders_are_normalised_as_on_link() {
    let stored = json!([{"projectId": ID, "folder": "  Overleaf/a/ "}]);
    assert_eq!(parse_links(&stored), vec![link(ID, "Overleaf/a")]);
}

#[test]
fn link_takes_a_pasted_project_url_and_defaults_the_folder() {
    let page = format!("https://www.overleaf.com/project/{ID}");
    let links = apply_link_action(&[], "link", Some(page.as_str()), None).unwrap();
    assert_eq!(links, vec![link(ID, &format!("Overleaf/{ID}"))]);

    let git = format!("https://git.overleaf.com/{OTHER}");
    let links = apply_link_action(&links, "link", Some(git.as_str()), Some("")).unwrap();
    assert_eq!(
        links.last(),
        Some(&link(OTHER, &format!("Overleaf/{OTHER}")))
    );
}

#[test]
fn link_refuses_the_same_project_twice() {
    let links = vec![link(ID, "Overleaf/thesis")];
    assert_eq!(
        apply_link_action(&links, "link", Some(ID), Some("other")).unwrap_err(),
        ALREADY_LINKED
    );
    let page = format!("https://www.overleaf.com/project/{ID}");
    assert_eq!(
        apply_link_action(&links, "link", Some(page.as_str()), None).unwrap_err(),
        ALREADY_LINKED
    );
}

#[test]
fn link_refuses_a_folder_equal_inside_or_containing_a_linked_folder() {
    let links = vec![link(ID, "Overleaf/a/b")];
    for folder in ["Overleaf/a/b", "Overleaf/a/b/c", "Overleaf/a"] {
        assert_eq!(
            apply_link_action(&links, "link", Some(OTHER), Some(folder)).unwrap_err(),
            FOLDER_TAKEN,
            "{folder}"
        );
    }
    // A shared name prefix is not nesting.
    assert!(apply_link_action(&links, "link", Some(OTHER), Some("Overleaf/a/bc")).is_ok());
}

#[test]
fn link_refuses_a_bad_project_a_bad_folder_and_an_unknown_action() {
    assert_eq!(
        apply_link_action(&[], "link", Some("https://evil.example/project/abc"), None).unwrap_err(),
        BAD_PROJECT
    );
    assert_eq!(
        apply_link_action(&[], "link", None, None).unwrap_err(),
        BAD_PROJECT
    );
    assert_eq!(
        apply_link_action(&[], "link", Some("abc"), Some("../out")).unwrap_err(),
        BAD_FOLDER
    );
    assert_eq!(
        apply_link_action(&[], "nope", None, None).unwrap_err(),
        NOT_AN_ACTION
    );
}

#[test]
fn list_returns_the_links_unchanged() {
    let links = vec![link(ID, "Overleaf/a"), link(OTHER, "Overleaf/b")];
    assert_eq!(
        apply_link_action(&links, "list", None, None).unwrap(),
        links
    );
}

#[test]
fn unlink_unknown_project_gives_exact_message() {
    let links = vec![link(ID, "Overleaf/thesis")];
    assert_eq!(
        apply_link_action(&links, "unlink", Some(OTHER), None).unwrap_err(),
        NOT_LINKED
    );
    assert_eq!(
        apply_link_action(&links, "unlink", None, None).unwrap_err(),
        NOT_LINKED
    );
}

#[test]
fn unlink_known_project_removes_only_it() {
    let links = vec![link(ID, "Overleaf/a"), link(OTHER, "Overleaf/b")];
    assert_eq!(
        apply_link_action(&links, "unlink", Some(ID), None).unwrap(),
        vec![link(OTHER, "Overleaf/b")]
    );
}

#[test]
fn status_pull_and_push_pass_the_link_check_on_a_linked_project() {
    let links = vec![link(ID, "Overleaf/thesis")];
    for action in ["status", "pull", "push"] {
        assert_eq!(
            apply_link_action(&links, action, Some(ID), None).unwrap(),
            links,
            "{action}"
        );
        assert_eq!(
            apply_link_action(&links, action, Some(OTHER), None).unwrap_err(),
            NOT_LINKED,
            "{action}"
        );
    }
}

#[test]
fn inside_vault_refuses_a_dotdot_escape() {
    let vault = TempDir::new();
    for escape in ["../x", "a/../../x", ""] {
        assert_eq!(
            inside_vault(vault.path(), escape).unwrap_err(),
            OUTSIDE,
            "{escape}"
        );
    }
    assert_eq!(
        inside_vault(vault.path(), "a/../b").unwrap(),
        vault.path().join("b")
    );
}

#[test]
fn inside_vault_allows_a_missing_target() {
    let vault = TempDir::new();
    assert_eq!(
        inside_vault(vault.path(), "Overleaf/new").unwrap(),
        vault.path().join("Overleaf").join("new")
    );
}

#[test]
fn inside_vault_refuses_a_symlink_escape() {
    let vault = TempDir::new();
    let outside = TempDir::new();
    std::fs::create_dir_all(outside.path().join("sub")).unwrap();
    if let Err(why) = make_dir_link(outside.path(), &vault.path().join("Overleaf")) {
        eprintln!("skipping symlink escape case, cannot create a symlink: {why}");
        return;
    }
    assert_eq!(inside_vault(vault.path(), "Overleaf").unwrap_err(), OUTSIDE);
    assert_eq!(
        inside_vault(vault.path(), "Overleaf/sub").unwrap_err(),
        OUTSIDE
    );
}

#[test]
fn inside_vault_refuses_a_link_to_the_vault_itself() {
    let vault = TempDir::new();
    if let Err(why) = make_dir_link(vault.path(), &vault.path().join("Overleaf")) {
        eprintln!("skipping link-to-root case, cannot create a symlink: {why}");
        return;
    }
    assert_eq!(inside_vault(vault.path(), "Overleaf").unwrap_err(), OUTSIDE);
}

#[test]
fn link_folders_trim_js_whitespace() {
    assert_eq!(
        check_link_folder("\u{feff}\u{a0}Overleaf/thesis\u{2028}").unwrap(),
        "Overleaf/thesis"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn link_then_list_shows_the_link_and_it_persists() {
    let vault_dir = TempDir::new();
    let dir = TempDir::new();
    let vault = vault_at(vault_dir.path());
    let secrets = fresh_secrets(None);
    let expected = vec![link(ID, "Overleaf/thesis")];

    let reply = run(
        &prefs_in(&dir),
        &secrets,
        &vault,
        "link",
        Some(ID),
        Some("Overleaf/thesis"),
    )
    .await
    .unwrap();
    assert_eq!(reply.links, expected);

    let listed = run(&prefs_in(&dir), &secrets, &vault, "list", None, None)
        .await
        .unwrap();
    assert_eq!(listed.links, expected);

    let stored = prefs_in(&dir).read("overleaf-links").unwrap();
    assert_eq!(
        stored,
        Some(PrefValue::Text(
            r#"[{"projectId":"64f0c0ffee0123456789abcd","folder":"Overleaf/thesis"}]"#.to_owned()
        ))
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn has_token_is_false_then_true_after_storing_a_token() {
    let vault_dir = TempDir::new();
    let dir = TempDir::new();
    let vault = vault_at(vault_dir.path());
    let prefs = prefs_in(&dir);
    let secrets = fresh_secrets(None);

    let before = run(&prefs, &secrets, &vault, "list", None, None)
        .await
        .unwrap();
    assert!(!before.has_token);

    secrets.write("overleaf-token", "olp_token").unwrap();
    let after = run(&prefs, &secrets, &vault, "list", None, None)
        .await
        .unwrap();
    assert!(after.has_token);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_vault_root_gives_the_exact_message() {
    let dir = TempDir::new();
    let err = run(
        &prefs_in(&dir),
        &fresh_secrets(None),
        &VaultState::new(),
        "list",
        None,
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(err, NO_ROOT);
    assert_eq!(NO_ROOT, "No workspace folder is chosen yet.");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unreadable_stored_links_list_as_none() {
    let vault_dir = TempDir::new();
    let dir = TempDir::new();
    let prefs = prefs_in(&dir);
    prefs
        .write(
            "overleaf-links",
            Some(PrefValue::Text("not json".to_owned())),
        )
        .unwrap();
    let reply = run(
        &prefs,
        &fresh_secrets(None),
        &vault_at(vault_dir.path()),
        "list",
        None,
        None,
    )
    .await
    .unwrap();
    assert!(reply.links.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unlink_forgets_the_link_and_leaves_the_files_where_they_are() {
    let vault_dir = TempDir::new();
    let dir = TempDir::new();
    let vault = vault_at(vault_dir.path());
    let prefs = prefs_in(&dir);
    let secrets = fresh_secrets(None);
    let _ = run(
        &prefs,
        &secrets,
        &vault,
        "link",
        Some(ID),
        Some("Overleaf/thesis"),
    )
    .await
    .unwrap();
    common::put(
        &vault_dir.path().join("Overleaf/thesis/main.tex"),
        b"\\documentclass{article}\n",
    );

    let reply = run(&prefs, &secrets, &vault, "unlink", Some(ID), None)
        .await
        .unwrap();

    assert!(reply.links.is_empty());
    assert!(
        vault_dir
            .path()
            .join("Overleaf")
            .join("thesis")
            .join("main.tex")
            .is_file()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_project_relinked_after_unlink_lists_only_the_new_folder() {
    let vault_dir = TempDir::new();
    let dir = TempDir::new();
    let vault = vault_at(vault_dir.path());
    let prefs = prefs_in(&dir);
    let secrets = fresh_secrets(None);
    let _ = run(
        &prefs,
        &secrets,
        &vault,
        "link",
        Some(ID),
        Some("Overleaf/a"),
    )
    .await
    .unwrap();
    let _ = run(&prefs, &secrets, &vault, "unlink", Some(ID), None)
        .await
        .unwrap();

    let reply = run(
        &prefs,
        &secrets,
        &vault,
        "link",
        Some(ID),
        Some("Overleaf/b"),
    )
    .await
    .unwrap();

    assert_eq!(reply.links, vec![link(ID, "Overleaf/b")]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pull_and_push_need_a_token_and_a_linked_project() {
    let vault_dir = TempDir::new();
    let dir = TempDir::new();
    let vault = vault_at(vault_dir.path());
    let prefs = prefs_in(&dir);
    let _ = run(
        &prefs,
        &fresh_secrets(None),
        &vault,
        "link",
        Some(ID),
        Some("Overleaf/thesis"),
    )
    .await
    .unwrap();

    let no_token = fresh_secrets(None);
    let pull = run(&prefs, &no_token, &vault, "pull", Some(ID), None)
        .await
        .unwrap_err();
    assert_eq!(pull, NO_TOKEN);
    let push = run(&prefs, &no_token, &vault, "push", Some("unlinked"), None)
        .await
        .unwrap_err();
    assert_eq!(push, NOT_LINKED);
    let status = run(&prefs, &no_token, &vault, "status", Some("unlinked"), None)
        .await
        .unwrap_err();
    assert_eq!(status, NOT_LINKED);

    // No remote exists for this id, so git fails; the token must not leak into the reason.
    let with_token = fresh_secrets(Some(TOKEN));
    let pulled = run(&prefs, &with_token, &vault, "pull", Some(ID), None)
        .await
        .unwrap_err();
    assert!(!pulled.is_empty());
    assert!(!pulled.contains(TOKEN));
}

#[test]
fn overleaf_git_dir_is_twelve_hex_then_the_project_id() {
    let store = Path::new("store");
    let dir = overleaf_git_dir(store, Path::new("vault"), "Overleaf/a", ID);
    assert_eq!(
        dir,
        overleaf_git_dir(store, Path::new("vault"), "Overleaf/a", ID)
    );
    let name = dir.file_name().unwrap().to_string_lossy().into_owned();
    let hash = name.strip_suffix(&format!("-{ID}.git")).unwrap();
    assert_eq!(hash.len(), 12);
    assert!(
        hash.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    );
    assert_eq!(dir.parent(), Some(store));
}

#[test]
fn overleaf_git_dir_differs_by_folder_and_by_root() {
    let store = Path::new("store");
    let base = overleaf_git_dir(store, Path::new("vault"), "Overleaf/a", ID);
    assert_ne!(
        base,
        overleaf_git_dir(store, Path::new("vault"), "Overleaf/b", ID)
    );
    assert_ne!(
        base,
        overleaf_git_dir(store, Path::new("other"), "Overleaf/a", ID)
    );
    assert_ne!(
        base,
        overleaf_git_dir(store, Path::new("vault"), "Overleaf/a", OTHER)
    );
}

#[cfg(windows)]
#[test]
fn overleaf_git_dir_ignores_the_verbatim_prefix() {
    let plain = overleaf_git_dir(Path::new("s"), Path::new(r"C:\x"), "f", ID);
    let verbatim = overleaf_git_dir(Path::new("s"), Path::new(r"\\?\C:\x"), "f", ID);
    assert_eq!(plain, verbatim);
}

/// The hash Electron's `overleafGitDir` gave for each spelling of one root
/// (`path.resolve` then SHA-256), so links made there keep their history.
#[cfg(windows)]
#[test]
fn overleaf_git_dir_matches_electron_on_windows() {
    let want = Path::new("s").join(format!("da792d47724e-{ID}.git"));
    for root in [
        r"C:\Users\a\Vault",
        r"C:\Users\a\Vault\",
        "C:/Users/a/Vault/",
        r"\\?\C:\Users\a\Vault",
    ] {
        assert_eq!(
            overleaf_git_dir(Path::new("s"), Path::new(root), "papers/thesis", ID),
            want,
            "{root}"
        );
    }
}

#[cfg(unix)]
#[test]
fn overleaf_git_dir_matches_electron_on_unix() {
    let want = Path::new("s").join(format!("591426e1bf40-{ID}.git"));
    for root in ["/home/a/Vault", "/home/a/Vault/"] {
        assert_eq!(
            overleaf_git_dir(Path::new("s"), Path::new(root), "papers/thesis", ID),
            want,
            "{root}"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pull_then_push_then_status_round_trip_with_the_remote() {
    let vault_dir = TempDir::new();
    let dir = TempDir::new();
    let remote = TempDir::new();
    let store = TempDir::new();
    let vault = vault_at(vault_dir.path());
    let prefs = prefs_in(&dir);
    let secrets = fresh_secrets(Some(TOKEN));
    let _ = run(
        &prefs,
        &secrets,
        &vault,
        "link",
        Some(ID),
        Some("Overleaf/thesis"),
    )
    .await
    .unwrap();
    let bare = bare_remote_with_main(remote.path(), ID);
    let git = OverleafGit {
        store: store.path().to_path_buf(),
        remote_base: format!("{}{}", remote.path().display(), std::path::MAIN_SEPARATOR),
    };
    assert_eq!(OVERLEAF_GIT_URL, "https://git.overleaf.com/");
    assert_eq!(OVERLEAF_BRANCH, "master");
    let folder = vault_dir.path().join("Overleaf").join("thesis");

    let pulled = run_with(&prefs, &secrets, &vault, &git, "pull", Some(ID), None)
        .await
        .unwrap();
    assert!(matches!(pulled.pull, Some(SyncPull::FastForward { .. })));
    assert!(pulled.status.is_none() && pulled.push.is_none());
    assert!(folder.join("main.tex").is_file());
    assert!(!folder.join(".git").exists());

    common::put(&folder.join("notes.tex"), b"% notes\n");
    let pushed = run_with(&prefs, &secrets, &vault, &git, "push", Some(ID), None)
        .await
        .unwrap();
    assert_eq!(pushed.push, Some(SyncPush::Pushed));
    assert_eq!(master_commits(&bare), 2);

    let status = run_with(&prefs, &secrets, &vault, &git, "status", Some(ID), None)
        .await
        .unwrap();
    let status: SyncStatus = status.status.unwrap();
    assert_eq!(status.branch, "master");
    assert_eq!((status.ahead, status.behind), (0, 0));
}
