import type { WorkspaceSnapshot } from "../workspace/workspace-snapshot.js";

/**
 * An empty snapshot with every collection present, for tests that care about
 * one collection and need the rest to exist.
 *
 * Shared because four suites had grown their own copy of this literal, and a
 * snapshot fixture is exactly the thing that goes stale in three places when a
 * collection is added to `WorkspaceSnapshot` in the fourth: the type error
 * lands in whichever file is compiled, and the others keep passing a snapshot
 * that no longer matches the shape.
 */
export function emptyWorkspaceSnapshot(
  overrides: Partial<WorkspaceSnapshot> = {},
): WorkspaceSnapshot {
  return {
    papers: [],
    vaultPages: [],
    readingLists: [],
    readingListItems: [],
    reportSections: [],
    experiments: [],
    milestones: [],
    logEntries: [],
    relations: [],
    tags: [],
    readerAnnotations: [],
    collectedAt: "2026-08-05T00:00:00.000Z",
    ...overrides,
  };
}
