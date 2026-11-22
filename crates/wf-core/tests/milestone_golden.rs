//! Golden milestone files, written exactly as the web writer
//! (`apps/web/src/features/plan/infrastructure/file-milestone-repo.ts`) writes
//! them, read back through the Rust feed path.
//!
//! Laws:
//! - The fixture reads to the same feed item the web reader shows.
//! - `due` is used only when `target-date` is absent.
//! - An invalid calendar day is badged and left out of the feed item.

use wf_core::plan::milestone_file::milestone_feed_item;
use wf_core::sync::entity_file::parse_entity_file;

const SAVED: &str = "---\n\
weaveforge-id: ms-7f3a\n\
weaveforge-type: milestone\n\
title: Submit thesis draft\n\
status: in_progress\n\
target-date: 2026-12-01\n\
created-at: 2026-11-02T09:00:00.000Z\n\
dependencies: []\n\
compute: []\n\
---\n\
Send chapter 4 to the supervisor.\n";

#[test]
fn a_saved_milestone_reads_to_the_feed_item_the_web_shows() {
    let file = parse_entity_file(SAVED).expect("a milestone file");
    let read = milestone_feed_item(&file, Some("Thesis"));
    assert!(!read.bad_date);
    assert_eq!(read.item.id, "ms-7f3a");
    assert_eq!(read.item.title, "Submit thesis draft");
    assert_eq!(read.item.status, "in_progress");
    assert_eq!(read.item.target_date.as_deref(), Some("2026-12-01"));
    assert_eq!(
        read.item.description.as_deref(),
        Some("Send chapter 4 to the supervisor.")
    );
    assert_eq!(read.item.project_name.as_deref(), Some("Thesis"));
}

#[test]
fn due_is_the_date_only_when_target_date_is_absent() {
    let text = SAVED
        .replace("target-date: 2026-12-01\n", "")
        .replace("status: in_progress\n", "due: 2026-12-05\n");
    let file = parse_entity_file(&text).expect("a milestone file");
    let read = milestone_feed_item(&file, None);
    assert_eq!(read.item.target_date.as_deref(), Some("2026-12-05"));
    assert_eq!(read.item.status, "planned");
}

#[test]
fn an_impossible_day_is_badged_and_left_out() {
    let text = SAVED.replace("target-date: 2026-12-01", "target-date: 2026-02-30");
    let file = parse_entity_file(&text).expect("a milestone file");
    let read = milestone_feed_item(&file, None);
    assert!(read.bad_date);
    assert_eq!(read.item.target_date, None);
}
