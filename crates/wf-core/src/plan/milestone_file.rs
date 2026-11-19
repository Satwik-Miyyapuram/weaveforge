//! Milestone files to calendar feed items. The milestone file is the truth;
//! the feed is built from it and never writes back.
//!
//! Laws (proved in `tests/plan_feed.rs`):
//! - The date is `target-date`, or `due` when the file has no `target-date`.
//! - A date that is not a real `yyyy-mm-dd` day is badged and left out of the
//!   `.ics`; the file is not changed.

use super::feed::FeedMilestone;
use super::milestone::is_iso_day;
use crate::sync::entity_file::EntityFile;

/// One milestone file read for the feed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MilestoneFeedItem {
    /// The feed item. An invalid date is dropped here, so the calendar skips it.
    pub item: FeedMilestone,
    /// True when the file names a date that is not a real calendar day.
    pub bad_date: bool,
}

/// The feed item for a milestone file, with `project_name` as the owning project.
#[must_use]
pub fn milestone_feed_item(file: &EntityFile, project_name: Option<&str>) -> MilestoneFeedItem {
    let date = file.field("target-date").or_else(|| file.field("due"));
    let bad_date = date.as_deref().is_some_and(|d| !is_iso_day(d));
    let body = file.body.trim();
    MilestoneFeedItem {
        item: FeedMilestone {
            id: file.id.clone(),
            title: file.field("title").unwrap_or_else(|| file.id.clone()),
            description: (!body.is_empty()).then(|| body.to_owned()),
            status: file.field("status").unwrap_or_else(|| "planned".to_owned()),
            target_date: date.filter(|_| !bad_date),
            project_name: project_name.map(str::to_owned),
        },
        bad_date,
    }
}
