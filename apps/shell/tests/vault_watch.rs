#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Tests for the vault watch batcher (ported from apps/desktop/test/vault-watch.test.ts).

use std::time::{Duration, Instant};

use weaveforge_shell::vault_watch::{QUIET, SELF_WRITE_WINDOW, VaultWatch};

/// A fake clock: a fixed base instant plus an offset the test moves.
struct Clock {
    base: Instant,
    at: Duration,
}

impl Clock {
    fn new() -> Self {
        Self {
            base: Instant::now(),
            at: Duration::ZERO,
        }
    }

    fn now(&self) -> Instant {
        self.base + self.at
    }

    fn advance(&mut self, ms: u64) {
        self.at += Duration::from_millis(ms);
    }
}

/// The TS harness: quiet 5 ms, self-write window 100 ms, identity normalize.
fn watch() -> VaultWatch {
    VaultWatch::new(
        Box::new(|p: &str| p.to_string()),
        Duration::from_millis(5),
        Duration::from_millis(100),
    )
}

/// Lets the quiet timer fire: flush at the deadline, or now when nothing is pending.
fn quiet(watch: &mut VaultWatch, clock: &Clock) -> Vec<String> {
    let at = watch.deadline().unwrap_or_else(|| clock.now());
    watch.flush(at)
}

#[test]
fn an_external_change_is_reported_once_things_go_quiet() {
    let clock = Clock::new();
    let mut w = watch();
    w.saw("notes/one.note.md", clock.now());
    assert_eq!(
        Vec::<String>::new(),
        w.flush(clock.now()),
        "nothing is reported before the folder settles"
    );
    assert_eq!(quiet(&mut w, &clock), vec!["notes/one.note.md"]);
}

#[test]
fn one_save_arriving_as_several_events_is_one_batch() {
    let clock = Clock::new();
    let mut w = watch();
    // An atomic save lands as a write, a rename, and a write again.
    w.saw("a.md", clock.now());
    w.saw("a.md", clock.now());
    w.saw("a.md", clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["a.md"]);
}

#[test]
fn several_files_changing_together_are_one_batch_sorted() {
    let clock = Clock::new();
    let mut w = watch();
    w.saw("b.md", clock.now());
    w.saw("a.md", clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["a.md", "b.md"]);
}

#[test]
fn our_own_write_is_not_news() {
    let clock = Clock::new();
    let mut w = watch();
    w.note_self_write("mirrored.md", clock.now());
    w.saw("mirrored.md", clock.now());
    assert_eq!(Vec::<String>::new(), quiet(&mut w, &clock));
}

#[test]
fn an_echo_is_forgiven_once_not_forever() {
    let clock = Clock::new();
    let mut w = watch();
    w.note_self_write("mirrored.md", clock.now());
    w.saw("mirrored.md", clock.now());
    // Somebody edits the file the mirror has just written. That is real news.
    w.saw("mirrored.md", clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["mirrored.md"]);
}

#[test]
fn a_change_long_after_our_write_is_reported() {
    let mut clock = Clock::new();
    let mut w = watch();
    w.note_self_write("mirrored.md", clock.now());
    clock.advance(500);
    w.saw("mirrored.md", clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["mirrored.md"]);
}

#[test]
fn our_write_to_one_file_does_not_hide_a_change_to_another() {
    let clock = Clock::new();
    let mut w = watch();
    w.note_self_write("mine.md", clock.now());
    w.saw("mine.md", clock.now());
    w.saw("theirs.md", clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["theirs.md"]);
}

#[test]
fn stopping_drops_what_was_pending() {
    let clock = Clock::new();
    let mut w = watch();
    w.saw("a.md", clock.now());
    w.stop();
    assert_eq!(Vec::<String>::new(), quiet(&mut w, &clock));
}

#[test]
fn a_quiet_folder_reports_nothing() {
    let clock = Clock::new();
    let mut w = watch();
    assert_eq!(Vec::<String>::new(), quiet(&mut w, &clock));
}

#[test]
fn a_self_write_spelled_differently_is_still_recognised_as_our_own() {
    let clock = Clock::new();
    // Stands in for the folding the writer does: the renderer's spelling and
    // the filesystem's spelling have to meet somewhere.
    let mut w = VaultWatch::new(
        Box::new(|p: &str| {
            let s = p.replace('\\', "/");
            match s.strip_prefix("./") {
                Some(rest) => rest.to_string(),
                None => s.clone(),
            }
        }),
        Duration::from_millis(5),
        Duration::from_millis(100),
    );
    w.note_self_write(".\\notes\\mine.md", clock.now());
    w.saw("notes/mine.md", clock.now());
    w.saw("notes/theirs.md", clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["notes/theirs.md"]);
}

#[test]
fn two_saws_300_ms_apart_report_both_once_at_the_second_deadline() {
    let mut clock = Clock::new();
    let mut w = VaultWatch::new(Box::new(|p: &str| p.to_string()), QUIET, SELF_WRITE_WINDOW);
    w.saw("a.md", clock.now());
    clock.advance(300);
    w.saw("b.md", clock.now());
    // The first saw's deadline has moved: first + 400 ms is still too early.
    clock.advance(100);
    assert_eq!(Vec::<String>::new(), w.flush(clock.now()));
    clock.advance(300);
    assert_eq!(w.flush(clock.now()), vec!["a.md", "b.md"]);
    assert_eq!(Vec::<String>::new(), w.flush(clock.now()));
}

#[test]
fn same_path_twice_is_reported_once() {
    let clock = Clock::new();
    let mut w = VaultWatch::new(Box::new(|p: &str| p.to_string()), QUIET, SELF_WRITE_WINDOW);
    w.saw("a.md", clock.now());
    w.saw("a.md", clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["a.md"]);
}

#[test]
fn self_write_then_saw_within_two_seconds_is_dropped_and_at_2_1_seconds_reported() {
    let mut clock = Clock::new();
    let mut w = VaultWatch::new(Box::new(|p: &str| p.to_string()), QUIET, SELF_WRITE_WINDOW);
    w.note_self_write("a.md", clock.now());
    clock.advance(1_999);
    w.saw("a.md", clock.now());
    assert_eq!(Vec::<String>::new(), quiet(&mut w, &clock));

    let mut w = VaultWatch::new(Box::new(|p: &str| p.to_string()), QUIET, SELF_WRITE_WINDOW);
    w.note_self_write("a.md", clock.now());
    clock.advance(2_100);
    w.saw("a.md", clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["a.md"]);
}

#[test]
fn normalize_is_applied_to_both_sides_of_a_self_write() {
    let clock = Clock::new();
    let mut w = VaultWatch::new(
        Box::new(|p: &str| p.replace('\\', "/").to_lowercase()),
        QUIET,
        SELF_WRITE_WINDOW,
    );
    w.note_self_write("A\\b.md", clock.now());
    w.saw("a/b.md", clock.now());
    assert_eq!(Vec::<String>::new(), quiet(&mut w, &clock));
}

#[test]
fn stop_drops_pending_and_clears_the_deadline() {
    let clock = Clock::new();
    let mut w = watch();
    w.saw("a.md", clock.now());
    assert!(w.deadline().is_some());
    w.stop();
    assert_eq!(w.deadline(), None);
    assert_eq!(
        Vec::<String>::new(),
        w.flush(clock.now() + Duration::from_secs(60))
    );
}

#[test]
fn deadline_is_none_after_a_flush_that_emptied_it() {
    let clock = Clock::new();
    let mut w = watch();
    assert_eq!(w.deadline(), None);
    w.saw("a.md", clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["a.md"]);
    assert_eq!(w.deadline(), None);
}

#[test]
fn deadline_moves_forward_on_each_saw() {
    let mut clock = Clock::new();
    let mut w = VaultWatch::new(Box::new(|p: &str| p.to_string()), QUIET, SELF_WRITE_WINDOW);
    w.saw("a.md", clock.now());
    assert_eq!(w.deadline(), Some(clock.now() + QUIET));
    clock.advance(300);
    w.saw("b.md", clock.now());
    assert_eq!(w.deadline(), Some(clock.now() + QUIET));
    assert!(w.deadline() > Some(clock.base + QUIET));
}
