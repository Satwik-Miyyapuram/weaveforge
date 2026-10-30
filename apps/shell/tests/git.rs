#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
mod common;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::{TempDir, put};
use serde_json::json;
use weaveforge_shell::git::{
    CommitReply, GIT_TIMED_OUT, GIT_TIMEOUT, GitQueue, GitQueueError, WorkspaceCommit,
    commit_vault_folder, log_limit, vault_log,
};
use weaveforge_shell::vault::NO_ROOT;
use wf_store::git::repo::{FolderRepo, MIRROR_AUTHOR};

type Spans = Arc<Mutex<Vec<(Instant, Instant)>>>;

fn is_oid(text: &str) -> bool {
    text.len() == 40 && text.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn napping(spans: &Spans, millis: u64) -> impl FnOnce() + Send + 'static {
    let spans = Arc::clone(spans);
    move || {
        let start = Instant::now();
        std::thread::sleep(Duration::from_millis(millis));
        let end = Instant::now();
        spans.lock().unwrap().push((start, end));
    }
}

#[test]
fn log_limit_cases() {
    let cases: Vec<(Option<serde_json::Value>, usize)> = vec![
        (None, 20),
        (Some(json!(null)), 20),
        (Some(json!(0)), 20),
        (Some(json!(-3)), 20),
        (Some(json!(2.5)), 20),
        (Some(json!("5")), 20),
        (Some(json!(true)), 20),
        (Some(json!(1)), 1),
        (Some(json!(5)), 5),
        (Some(json!(200)), 200),
        (Some(json!(201)), 200),
        (Some(json!(u64::MAX)), 200),
        (Some(json!(5.0)), 5),
        (Some(json!(1e300)), 200),
        (Some(json!(-0.0)), 20),
    ];
    for (value, want) in cases {
        assert_eq!(log_limit(value.as_ref()), want, "{value:?}");
    }
}

#[test]
fn workspace_commit_json() {
    let commit = WorkspaceCommit {
        oid: "abc".to_owned(),
        authored_at: "2026-01-01T00:00:00+00:00".to_owned(),
        author: "WeaveForge".to_owned(),
        message: "m".to_owned(),
    };
    assert_eq!(
        serde_json::to_value(&commit).unwrap(),
        json!({
            "oid": "abc",
            "authoredAt": "2026-01-01T00:00:00+00:00",
            "author": "WeaveForge",
            "message": "m"
        })
    );
}

#[test]
fn commit_reply_json() {
    let none = CommitReply {
        commit: None,
        reason: None,
    };
    assert_eq!(
        serde_json::to_value(&none).unwrap(),
        json!({"commit": null})
    );
    let some = CommitReply {
        commit: None,
        reason: Some("x".to_owned()),
    };
    assert_eq!(
        serde_json::to_value(&some).unwrap(),
        json!({"commit": null, "reason": "x"})
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_root_is_an_error() {
    let queue = GitQueue::default();
    let result = commit_vault_folder(&queue, None, true, GIT_TIMEOUT).await;
    assert_eq!(result, Err(NO_ROOT.to_owned()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn disabled_does_nothing() {
    let dir = TempDir::new();
    put(&dir.path().join("a.md"), b"x");
    let queue = GitQueue::default();
    let reply = commit_vault_folder(&queue, Some(dir.path().to_path_buf()), false, GIT_TIMEOUT)
        .await
        .unwrap();
    assert!(reply.commit.is_none());
    assert!(!dir.path().join(".git").exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn first_commit_then_nothing_to_commit() {
    let dir = TempDir::new();
    put(&dir.path().join("a.md"), b"x");
    let queue = GitQueue::default();
    let first = commit_vault_folder(&queue, Some(dir.path().to_path_buf()), true, GIT_TIMEOUT)
        .await
        .unwrap();
    let commit = first.commit.as_ref().unwrap();
    assert!(is_oid(&commit.oid));
    assert_eq!(commit.author, "WeaveForge");
    assert!(!commit.message.is_empty());
    assert_eq!(first.reason, None);
    assert!(dir.path().join(".git").exists());

    let again = commit_vault_folder(&queue, Some(dir.path().to_path_buf()), true, GIT_TIMEOUT)
        .await
        .unwrap();
    assert_eq!(
        again,
        CommitReply {
            commit: None,
            reason: None
        }
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn log_after_commit() {
    let dir = TempDir::new();
    put(&dir.path().join("a.md"), b"x");
    let queue = GitQueue::default();
    let commit = commit_vault_folder(&queue, Some(dir.path().to_path_buf()), true, GIT_TIMEOUT)
        .await
        .unwrap()
        .commit
        .unwrap();
    let log = vault_log(dir.path().to_path_buf(), 20).await;
    assert_eq!(log.len(), 1);
    assert_eq!(
        log.first().map(|c| c.oid.as_str()),
        Some(commit.oid.as_str())
    );

    let bare = TempDir::new();
    put(&bare.path().join("a.md"), b"x");
    assert!(vault_log(bare.path().to_path_buf(), 20).await.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn log_is_empty_inside_an_enclosing_repo() {
    let dir = TempDir::new();
    FolderRepo::new(dir.path()).init().unwrap();
    put(&dir.path().join("top.md"), b"x");
    let _seed = FolderRepo::new(dir.path())
        .commit_all("seed", MIRROR_AUTHOR)
        .unwrap();

    let sub = dir.path().join("sub");
    put(&sub.join("x.md"), b"y");
    assert!(vault_log(sub.clone(), 20).await.is_empty());

    let queue = GitQueue::default();
    let reply = commit_vault_folder(&queue, Some(sub), true, GIT_TIMEOUT)
        .await
        .unwrap();
    assert!(reply.commit.is_none());
    assert!(reply.reason.as_deref().is_some_and(|r| !r.is_empty()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn queue_runs_one_at_a_time() {
    let queue = GitQueue::default();
    let spans: Spans = Arc::default();
    let (a, b) = tokio::join!(
        queue.run(GIT_TIMEOUT, napping(&spans, 200)),
        queue.run(GIT_TIMEOUT, napping(&spans, 200)),
    );
    assert!(a.is_ok() && b.is_ok());
    let mut recorded = spans.lock().unwrap().clone();
    recorded.sort_by_key(|span| span.0);
    let [first, second] = recorded.as_slice() else {
        panic!("expected two spans, got {recorded:?}");
    };
    assert!(first.1 <= second.0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn queue_times_out_but_keeps_the_lock() {
    let queue = GitQueue::default();
    let a_before = Instant::now();
    let began = Instant::now();
    let timed_out = queue
        .run(Duration::from_millis(100), || {
            std::thread::sleep(Duration::from_secs(2));
        })
        .await;
    assert_eq!(timed_out, Err(GitQueueError::TimedOut));
    assert!(began.elapsed() < Duration::from_secs(1));

    let b_start = queue
        .run(Duration::from_secs(5), Instant::now)
        .await
        .unwrap();
    assert!(b_start >= a_before + Duration::from_millis(1900));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn queue_reports_a_panic() {
    let queue = GitQueue::default();
    let panicked = queue.run(GIT_TIMEOUT, || -> u8 { panic!("boom") }).await;
    assert_eq!(panicked, Err(GitQueueError::Panicked));
    let after = queue.run(GIT_TIMEOUT, || 7_u8).await;
    assert_eq!(after, Ok(7));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn commit_times_out() {
    let dir = TempDir::new();
    put(&dir.path().join("a.md"), b"x");
    let queue = Arc::new(GitQueue::default());
    let busy_queue = Arc::clone(&queue);
    let busy = tokio::spawn(async move {
        busy_queue
            .run(Duration::from_secs(5), || {
                std::thread::sleep(Duration::from_secs(1));
            })
            .await
    });
    tokio::time::sleep(Duration::from_millis(50)).await;

    let reply = commit_vault_folder(
        &queue,
        Some(dir.path().to_path_buf()),
        true,
        Duration::from_millis(50),
    )
    .await
    .unwrap();
    assert!(reply.commit.is_none());
    assert_eq!(reply.reason.as_deref(), Some(GIT_TIMED_OUT));

    let _ = busy.await;
    // The timed-out commit was dropped, not run once the queue freed up.
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!dir.path().join(".git").exists());
}
