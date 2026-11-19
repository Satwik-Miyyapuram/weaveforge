# Plan and logbook as files (0.9.5)

From 0.9.5 a milestone is a markdown file in your workspace and the calendar
feed is built from those files. The server keeps only the last published copy
of the feed, so your calendar keeps working when your computer is off.

## The milestone file

A milestone lives at `<project>/plan/<slug>--<id-suffix>.milestone.md`:

```markdown
---
weaveforge-id: 9a2d…
weaveforge-type: milestone
title: Submit draft
status: planned
target-date: 2026-12-01
created-at: 2026-11-01T00:00:00Z
---
Chapters 1 to 3.
```

- The body is the description.
- `status` is `planned`, `in_progress`, `done` or `blocked`; anything else
  reads as `planned`.
- The date is `target-date`. Older files that only have `due` are read from
  `due`; a save writes `target-date` and drops `due`.
- `dependencies` and `compute` are lists and appear only when not empty.

Log entries are files under `<project>/logbook/` (see [logbook](logbook.md)
for the entry rules).

## The calendar feed

1. Every save or delete of a milestone sends the whole feed to the relay
   (`POST /api/plan/feed/publish` with the feed id, the feed token and the
   items). The route needs your session and refuses a feed owned by someone
   else (403). Only a hash of the token is sent to the database.
2. The relay stores the items in `shared_docs` (kind `feed`) under that hash.
3. A calendar app fetching `https://…/api/plan/feed/wff_<token>/deadlines.ics`
   is answered from that stored copy. Your computer does not need to be on.
4. A rotated token gets a new hash; the old URL then answers 404. A feed never
   published answers 404 too.

## The code

| Part | Where | What |
| --- | --- | --- |
| Feed item | `crates/wf-core/src/plan/milestone_file.rs` | `milestone_feed_item`: a milestone file to one feed item, with the date rule and the bad-date badge. |
| Milestone repository | `apps/web/src/features/plan/infrastructure/file-milestone-repo.ts` | `FileMilestoneRepository`: the `IMilestoneRepository` contract over workspace files, publishing the feed after each change. `hasBadDate` drives the badge. |
| Feed routes | `apps/relay/server/src/plan_feed.rs` | Serving and publishing the stored feed. |

`FileMilestoneRepository` is not wired into the app yet; switching the backend
is lane L11.

## Laws

- **A saved milestone reads back unchanged**, and a save keeps the path and
  every field it does not own
  (`apps/web/src/features/plan/infrastructure/test/file-milestone-repo.test.ts`).
- **Every save and delete publishes the whole feed once**
  (`milestone_change_publishes_feed`, property test in
  `crates/wf-core/tests/plan_feed.rs` and in the repository test).
- **The date is `target-date`, else `due`** (`target_date_wins_over_due`,
  `due_is_read_when_target_date_is_missing`).
- **A date that is not a real day is badged, left out of the feed, and the file
  is not changed** (`invalid_due_date`, property test on random text).
- **No milestones is still a valid calendar** (`no_milestones_valid_calendar`).
- **The feed is served with the desktop off; a rotated or never-published token
  is 404** (`feed_served_with_desktop_off`, `token_rotated_old_url_404`,
  `never_published_404` in `apps/relay/server/tests/plan_feed.rs`).
- **The token never reaches the database query, only its hash**
  (`upstream_query_names_hash_never_token`, property test on random tokens).
- **A save never overwrites a file changed on disk since it was read.**
