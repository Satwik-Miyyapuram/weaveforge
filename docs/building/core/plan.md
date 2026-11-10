# Plan core module

The `plan` module holds the pure rules for milestones: input checks, row
mapping, the timeline, the calendar feed, the dashboard widget summary and the
plan chip target. It works on milestones passed in as values. It does not read
the database or the clock.

## What lives in Rust

Source: `crates/wf-core/src/plan/`

- `milestone.rs`: validates milestone input (dates, dependencies, compute needs) and builds a new milestone.
- `milestone_row.rs`: maps a milestone to and from its database row.
- `timeline.rs`: builds the timeline, clusters marks, counts days to a date and works out the pace.
- `feed.rs`: builds the calendar feed (ICS) and the widget data.
- `feed_urls.rs`: builds the feed origin and the feed URLs.
- `chip.rs`: works out where a plan chip links to.
- `screen.rs`: sorts milestones by due date and builds the plan eyebrow text.

`mod.rs` describes the module as the parts of the plan that leave the app
(calendar feed, widget summary), and pure rules over milestones.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src` (`milestone.rs`,
`milestone_rows.rs`, `plan_timeline.rs`, `plan_feed.rs`, `plan_chip.rs`,
`plan_screen.rs`). The TypeScript wrappers in `packages/wf-wasm/src` import
the raw names from `../pkg/wf_wasm.js` and re-export them. The main names are:

- Milestone (`milestone.ts`): `isIsoDay`, `validateDependenciesError`,
  `validateComputeError`, `milestoneInputError`, `createMilestoneWith`.
- Rows (`milestone-rows.ts`): `milestoneFromRow`, `milestoneToRow`.
- Timeline (`plan-timeline.ts`): `planTimeline`, `clusterMarks`, `daysUntilDate`, `planPace`.
- Feed (`plan-feed.ts`): `planFeedOrigin`, `planFeedUrls`, `milestonesToIcs`,
  `planWidgetData`, `addDays`.
- Chip (`plan-chip.ts`): `planChipTarget`.
- Screen (`plan-screen.ts`): `sortByDue`, `planEyebrow`.

Code in `apps/web` reads these through `readyCore()` or `typedCore()` from
`apps/web/src/lib/rust-core.ts`, or through the wrappers in `packages/wf-wasm`.
`readyCore()` throws until `loadCore()` has resolved, so call it only after
the core has loaded.

## What stays in TypeScript, and why

- **Milestone persistence.** Repositories and use cases that read and write
  milestones stay in TypeScript. Rust maps rows and checks input; it never
  talks to the server.
- **Calendar and widget I/O.** Serving the feed and the widget data over HTTP
  or to the host stays in TypeScript. Rust builds the ICS text and the widget
  data.
- **Hooks and components.** The plan screen, timeline rendering and chip
  components stay in `apps/web/src/features/plan`.
- **Clock and identity.** The caller supplies the current day, the new id and
  the timestamp. Rust never reads the clock or generates ids, which keeps the
  rules repeatable in tests.
- **Type contracts.** The TypeScript types for milestones, dependencies and
  timeline shapes stay in `packages/core` and `packages/wf-wasm/src`.

## Related

- [AI core](ai.md)
- [Dashboard core](dashboard.md)
- [Logbook core](logbook.md)
- [Settings core](settings.md)

Source: `crates/wf-core/src/plan/`
