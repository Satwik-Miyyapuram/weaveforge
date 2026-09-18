/**
 * The demo workspace, as data.
 *
 * One thesis — a graph-structured prior for disentangled VAEs — described
 * completely enough that every screen has something to show: thirty-odd
 * papers with typed relations and tags, reading lists (one of them a
 * systematic-review screen), Zotero-shaped annotations pinned into a report,
 * milestones with compute and dependencies, a logbook, experiments with metric
 * curves and figures, a report outline, a vault of notes, custom paper fields
 * and citation alerts.
 *
 * Nothing here touches a database. `seedShowcase` (infrastructure) writes it
 * through whatever client it is handed, which is how the same workspace lands
 * in a Supabase account and in the no-account copy on a desktop.
 */

export * from "./papers";
export * from "./annotations";
export * from "./reading";
export * from "./plan";
export * from "./experiments";
export * from "./report";
