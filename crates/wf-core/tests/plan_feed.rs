//! Laws for the plan feed built from milestone files
//! (`wf_core::plan::milestone_file`, `wf_core::plan::feed`).

use proptest::prelude::*;
use serde_json::{Map, Value};
use wf_core::plan::feed::milestones_to_ics;
use wf_core::plan::feed_urls::plan_feed_urls;
use wf_core::plan::milestone_file::milestone_feed_item;
use wf_core::sync::entity_file::{EntityFile, parse_entity_file, render_entity_file};

const NOW: i64 = 1_790_000_000_000; // 2026-09-21

fn milestone(fields: &[(&str, &str)], body: &str) -> String {
    let mut map = Map::new();
    for (key, value) in fields {
        let _ = map.insert((*key).to_owned(), Value::from(*value));
    }
    render_entity_file(&EntityFile {
        id: "ms-1".to_owned(),
        entity_type: "milestone".to_owned(),
        wf: Some(3),
        fields: map,
        body: body.to_owned(),
    })
}

fn feed_of(text: &str) -> (String, bool) {
    let file = parse_entity_file(text);
    assert!(file.is_some(), "not an entity file: {text}");
    let Some(file) = file else {
        return (String::new(), false);
    };
    let read = milestone_feed_item(&file, Some("Thesis"));
    (
        milestones_to_ics(&[read.item], false, 1, NOW),
        read.bad_date,
    )
}

proptest! {
    /// Law: a milestone edit shows up in the next feed: the date and title in
    /// the file are the ones the calendar gets.
    #[test]
    fn milestone_change_publishes_feed(
        year in 2000i32..2100,
        month in 1u32..=12,
        day in 1u32..=28,
        title in "[A-Za-z][A-Za-z0-9 ]{0,20}",
    ) {
        let date = format!("{year}-{month:02}-{day:02}");
        let text = milestone(&[("title", title.trim()), ("status", "planned"), ("target-date", &date)], "");
        let (ics, bad) = feed_of(&text);
        prop_assert!(!bad);
        let stamp = format!("DTSTART;VALUE=DATE:{year}{month:02}{day:02}");
        prop_assert!(ics.contains(&stamp), "{}", ics);
        prop_assert!(ics.contains("UID:ms-1"), "{}", ics);
    }

    /// Law: an invalid date is badged, left out of the .ics, and the file
    /// text is unchanged.
    #[test]
    fn invalid_due_date(junk in "[0-9a-z-]{1,12}") {
        prop_assume!(!wf_core::plan::milestone::is_iso_day(&junk));
        let text = milestone(&[("title", "Submit"), ("due", &junk)], "");
        let before = text.clone();
        let (ics, bad) = feed_of(&text);
        prop_assert!(bad);
        prop_assert!(!ics.contains("BEGIN:VEVENT"), "{}", ics);
        prop_assert_eq!(text, before);
    }
}

#[test]
fn due_is_read_when_target_date_is_missing() {
    let (ics, bad) = feed_of(&milestone(&[("title", "Draft"), ("due", "2026-12-01")], ""));
    assert!(!bad);
    assert!(ics.contains("DTSTART;VALUE=DATE:20261201"), "{ics}");
}

#[test]
fn target_date_wins_over_due() {
    let text = milestone(&[("target-date", "2026-12-02"), ("due", "2026-12-01")], "");
    let (ics, _) = feed_of(&text);
    assert!(ics.contains("DTSTART;VALUE=DATE:20261202"), "{ics}");
}

#[test]
fn february_31_is_badged() {
    let (ics, bad) = feed_of(&milestone(&[("due", "2026-02-31")], ""));
    assert!(bad);
    assert!(!ics.contains("BEGIN:VEVENT"));
}

#[test]
fn no_milestones_valid_calendar() {
    let ics = milestones_to_ics(&[], false, 1, NOW);
    assert!(ics.starts_with("BEGIN:VCALENDAR\r\n"), "{ics}");
    assert!(ics.trim_end().ends_with("END:VCALENDAR"), "{ics}");
    assert!(!ics.contains("BEGIN:VEVENT"));
}

#[test]
fn token_rotated_changes_every_url() {
    let old = plan_feed_urls("https://api.example", "old-token", false, 1.0);
    let new = plan_feed_urls("https://api.example", "new-token", false, 1.0);
    for (a, b) in [
        (&old.ics, &new.ics),
        (&old.webcal, &new.webcal),
        (&old.widget, &new.widget),
    ] {
        assert_ne!(a, b);
        assert!(!b.contains("old-token"));
    }
}
