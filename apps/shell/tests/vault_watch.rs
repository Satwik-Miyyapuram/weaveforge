#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Tests for the vault watch batcher (ported from apps/desktop/test/vault-watch.test.ts).

use std::time::{Duration, Instant};

use weaveforge_shell::vault_watch::{
    Digest, MAX_WAIT, QUIET, SELF_WRITE_WINDOW, VaultWatch, content_digest, digest_reader,
};

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

/// The digest of the bytes this process wrote.
fn ours() -> Digest {
    content_digest(b"ours")
}

/// The digest of bytes someone else put in the file.
fn theirs() -> Digest {
    content_digest(b"theirs")
}

#[test]
fn an_external_change_is_reported_once_things_go_quiet() {
    let clock = Clock::new();
    let mut w = watch();
    w.saw("notes/one.note.md", Some(theirs()), clock.now());
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
    w.saw("a.md", Some(theirs()), clock.now());
    w.saw("a.md", Some(theirs()), clock.now());
    w.saw("a.md", Some(theirs()), clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["a.md"]);
}

#[test]
fn several_files_changing_together_are_one_batch_sorted() {
    let clock = Clock::new();
    let mut w = watch();
    w.saw("b.md", Some(theirs()), clock.now());
    w.saw("a.md", Some(theirs()), clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["a.md", "b.md"]);
}

#[test]
fn our_own_write_is_not_news() {
    let clock = Clock::new();
    let mut w = watch();
    w.note_self_write("mirrored.md", ours(), clock.now());
    w.saw("mirrored.md", Some(ours()), clock.now());
    assert_eq!(Vec::<String>::new(), quiet(&mut w, &clock));
}

#[test]
fn repeated_events_with_our_bytes_are_all_echoes() {
    let clock = Clock::new();
    let mut w = watch();
    w.note_self_write("mirrored.md", ours(), clock.now());
    w.saw("mirrored.md", Some(ours()), clock.now());
    w.saw("mirrored.md", Some(ours()), clock.now());
    assert_eq!(Vec::<String>::new(), quiet(&mut w, &clock));
}

#[test]
fn a_change_long_after_our_write_is_reported() {
    let mut clock = Clock::new();
    let mut w = watch();
    w.note_self_write("mirrored.md", ours(), clock.now());
    clock.advance(500);
    w.saw("mirrored.md", Some(ours()), clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["mirrored.md"]);
}

#[test]
fn an_outside_edit_right_after_our_write_is_reported() {
    let mut clock = Clock::new();
    let mut w = watch();
    w.note_self_write("mirrored.md", ours(), clock.now());
    clock.advance(100);
    w.saw("mirrored.md", Some(theirs()), clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["mirrored.md"]);
}

#[test]
fn a_deleted_file_right_after_our_write_is_reported() {
    let clock = Clock::new();
    let mut w = watch();
    w.note_self_write("mirrored.md", ours(), clock.now());
    w.saw("mirrored.md", None, clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["mirrored.md"]);
}

#[test]
fn after_an_outside_edit_our_old_bytes_are_no_longer_an_echo() {
    let clock = Clock::new();
    let mut w = watch();
    w.note_self_write("mirrored.md", ours(), clock.now());
    w.saw("mirrored.md", Some(theirs()), clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["mirrored.md"]);
    // The entry was dropped with the outside edit, so our old bytes are news now.
    w.saw("mirrored.md", Some(ours()), clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["mirrored.md"]);
}

#[test]
fn a_half_written_view_of_our_save_is_not_news_once_the_whole_save_lands() {
    // Linux reports the create before a big write finishes: the first hash sees part of it.
    let clock = Clock::new();
    let mut w = watch();
    w.note_self_write("big.pdf", ours(), clock.now());
    w.saw("big.pdf", Some(content_digest(b"ou")), clock.now());
    w.saw("big.pdf", Some(ours()), clock.now());
    assert_eq!(quiet(&mut w, &clock), Vec::<String>::new());
    assert_eq!(w.deadline(), None);
}

#[test]
fn a_half_written_view_of_our_save_does_not_hide_a_change_to_another_file() {
    let clock = Clock::new();
    let mut w = watch();
    w.saw("theirs.md", Some(theirs()), clock.now());
    w.note_self_write("big.pdf", ours(), clock.now());
    w.saw("big.pdf", None, clock.now());
    w.saw("big.pdf", Some(ours()), clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["theirs.md"]);
}

#[test]
fn an_outside_edit_that_ends_on_other_bytes_is_reported_after_a_view_of_ours() {
    let clock = Clock::new();
    let mut w = watch();
    w.note_self_write("a.md", ours(), clock.now());
    w.saw("a.md", Some(ours()), clock.now());
    w.saw("a.md", Some(theirs()), clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["a.md"]);
    // Reported, so no longer ours: our old bytes coming back are news too.
    w.saw("a.md", Some(ours()), clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["a.md"]);
}

#[test]
fn our_write_to_one_file_does_not_hide_a_change_to_another() {
    let clock = Clock::new();
    let mut w = watch();
    w.note_self_write("mine.md", ours(), clock.now());
    w.saw("mine.md", Some(ours()), clock.now());
    w.saw("theirs.md", Some(theirs()), clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["theirs.md"]);
}

#[test]
fn stopping_drops_what_was_pending() {
    let clock = Clock::new();
    let mut w = watch();
    w.saw("a.md", Some(theirs()), clock.now());
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
    w.note_self_write(".\\notes\\mine.md", ours(), clock.now());
    w.saw("notes/mine.md", Some(ours()), clock.now());
    w.saw("notes/theirs.md", Some(theirs()), clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["notes/theirs.md"]);
}

#[test]
fn two_saws_300_ms_apart_report_both_once_at_the_second_deadline() {
    let mut clock = Clock::new();
    let mut w = VaultWatch::new(Box::new(|p: &str| p.to_string()), QUIET, SELF_WRITE_WINDOW);
    w.saw("a.md", Some(theirs()), clock.now());
    clock.advance(300);
    w.saw("b.md", Some(theirs()), clock.now());
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
    w.saw("a.md", Some(theirs()), clock.now());
    w.saw("a.md", Some(theirs()), clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["a.md"]);
}

#[test]
fn self_write_then_saw_within_ten_seconds_is_dropped_and_at_10_1_seconds_reported() {
    let mut clock = Clock::new();
    let mut w = VaultWatch::new(Box::new(|p: &str| p.to_string()), QUIET, SELF_WRITE_WINDOW);
    w.note_self_write("a.md", ours(), clock.now());
    clock.advance(9_900);
    w.saw("a.md", Some(ours()), clock.now());
    assert_eq!(Vec::<String>::new(), quiet(&mut w, &clock));

    let mut w = VaultWatch::new(Box::new(|p: &str| p.to_string()), QUIET, SELF_WRITE_WINDOW);
    w.note_self_write("a.md", ours(), clock.now());
    clock.advance(10_100);
    w.saw("a.md", Some(ours()), clock.now());
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
    w.note_self_write("A\\b.md", ours(), clock.now());
    w.saw("a/b.md", Some(ours()), clock.now());
    assert_eq!(Vec::<String>::new(), quiet(&mut w, &clock));
}

#[test]
fn content_digest_tells_bytes_apart() {
    assert_eq!(content_digest(b"abc"), content_digest(b"abc"));
    assert_ne!(content_digest(b"a"), content_digest(b"b"));
    assert_ne!(content_digest(b""), content_digest(b"\0"));
}

#[test]
fn stop_drops_pending_and_clears_the_deadline() {
    let clock = Clock::new();
    let mut w = watch();
    w.saw("a.md", Some(theirs()), clock.now());
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
    w.saw("a.md", Some(theirs()), clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["a.md"]);
    assert_eq!(w.deadline(), None);
}

#[test]
fn deadline_moves_forward_on_each_saw() {
    let mut clock = Clock::new();
    let mut w = VaultWatch::new(Box::new(|p: &str| p.to_string()), QUIET, SELF_WRITE_WINDOW);
    w.saw("a.md", Some(theirs()), clock.now());
    assert_eq!(w.deadline(), Some(clock.now() + QUIET));
    clock.advance(300);
    w.saw("b.md", Some(theirs()), clock.now());
    assert_eq!(w.deadline(), Some(clock.now() + QUIET));
    assert!(w.deadline() > Some(clock.base + QUIET));
}

#[test]
fn two_quick_saves_then_a_late_echo_of_the_first_are_not_news() {
    let mut clock = Clock::new();
    let mut w = watch();
    let first = content_digest(b"first");
    let second = content_digest(b"second");
    w.note_self_write("a.md", first, clock.now());
    clock.advance(10);
    w.note_self_write("a.md", second, clock.now());
    w.saw("a.md", Some(first), clock.now());
    w.saw("a.md", Some(second), clock.now());
    assert_eq!(quiet(&mut w, &clock), Vec::<String>::new());
}

#[test]
fn an_outside_edit_after_two_quick_saves_is_reported() {
    let mut clock = Clock::new();
    let mut w = watch();
    w.note_self_write("a.md", content_digest(b"first"), clock.now());
    clock.advance(10);
    w.note_self_write("a.md", content_digest(b"second"), clock.now());
    w.saw("a.md", Some(theirs()), clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["a.md"]);
}

#[test]
fn our_own_delete_is_not_news() {
    let clock = Clock::new();
    let mut w = watch();
    w.note_self_remove("gone.md", clock.now());
    w.saw("gone.md", None, clock.now());
    assert_eq!(quiet(&mut w, &clock), Vec::<String>::new());
}

#[test]
fn a_file_recreated_by_someone_else_after_our_delete_is_reported() {
    let clock = Clock::new();
    let mut w = watch();
    w.note_self_remove("gone.md", clock.now());
    w.saw("gone.md", Some(theirs()), clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["gone.md"]);
}

#[test]
fn only_noted_paths_need_their_contents_read() {
    let clock = Clock::new();
    let mut w = watch();
    assert!(!w.expects("a.md"));
    w.note_self_write("a.md", ours(), clock.now());
    assert!(w.expects("a.md"));
    assert!(!w.expects("b.md"));
    w.note_self_remove("c.md", clock.now());
    assert!(w.expects("c.md"));
}

#[test]
fn a_file_changing_without_pause_still_flushes_within_the_max_wait() {
    let mut clock = Clock::new();
    let mut w = VaultWatch::new(Box::new(|p: &str| p.to_string()), QUIET, SELF_WRITE_WINDOW);
    let start = clock.now();
    w.saw("log.txt", Some(theirs()), clock.now());
    w.saw("note.md", Some(theirs()), clock.now());
    let mut flushed = Vec::new();
    for _ in 0..20 {
        clock.advance(300);
        flushed = w.flush(clock.now());
        if !flushed.is_empty() {
            break;
        }
        w.saw("log.txt", Some(theirs()), clock.now());
    }
    assert_eq!(flushed, vec!["log.txt", "note.md"]);
    assert!(clock.now() <= start + MAX_WAIT + Duration::from_millis(300));
    assert!(w.deadline().is_none());
}

#[test]
fn the_max_wait_restarts_after_each_batch() {
    let mut clock = Clock::new();
    let mut w = VaultWatch::new(Box::new(|p: &str| p.to_string()), QUIET, SELF_WRITE_WINDOW);
    w.saw("a.md", Some(theirs()), clock.now());
    clock.advance(500);
    assert_eq!(w.flush(clock.now()), vec!["a.md"]);
    clock.advance(5_000);
    w.saw("b.md", Some(theirs()), clock.now());
    assert_eq!(w.deadline(), Some(clock.now() + QUIET));
}

#[test]
fn a_streamed_digest_matches_the_whole_buffer_digest() {
    let bytes: Vec<u8> = (0..300_000u32)
        .map(|i| u8::try_from(i % 251).unwrap())
        .collect();
    assert_eq!(
        digest_reader(&mut bytes.as_slice()).unwrap(),
        content_digest(&bytes)
    );
    assert_eq!(
        digest_reader(&mut [].as_slice()).unwrap(),
        content_digest(b"")
    );
}

#[test]
fn something_unreadable_where_we_deleted_is_reported() {
    let clock = Clock::new();
    let mut w = watch();
    w.note_self_remove("gone.md", clock.now());
    w.saw_unreadable("gone.md", clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["gone.md"]);
}

#[test]
fn an_unreadable_file_where_we_wrote_is_reported() {
    let clock = Clock::new();
    let mut w = watch();
    w.note_self_write("a.md", ours(), clock.now());
    w.saw_unreadable("a.md", clock.now());
    assert_eq!(quiet(&mut w, &clock), vec!["a.md"]);
}
