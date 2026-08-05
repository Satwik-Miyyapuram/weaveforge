import assert from "node:assert/strict";
import test from "node:test";
import {
  collectWorkspaceSnapshot,
  workspaceSnapshotCounts,
  type WorkspaceSnapshotReaders,
} from "../src/index.js";

function lister<T>(items: T[]) {
  return { list: async () => items };
}

const NOW = "2026-08-05T00:00:00.000Z";

function readers(overrides: Partial<WorkspaceSnapshotReaders> = {}): WorkspaceSnapshotReaders {
  return {
    papers: lister([{ id: "p1", title: "Attention" } as never]),
    vaultPages: lister([{ id: "n1", title: "Method", body: "full body" } as never]),
    readingLists: lister([{ id: "l1", name: "To read" } as never]),
    reportSections: lister([]),
    experiments: lister([]),
    milestones: lister([]),
    logEntries: lister([]),
    ...overrides,
  };
}

test("collects every entity in one pass and stamps the time", async () => {
  const snapshot = await collectWorkspaceSnapshot(readers(), () => NOW);

  assert.equal(snapshot.papers.length, 1);
  assert.equal(snapshot.vaultPages.length, 1);
  assert.equal(snapshot.readingLists.length, 1);
  assert.equal(snapshot.collectedAt, NOW);
});

test("keeps full note bodies — the export bug this module exists to prevent", async () => {
  const snapshot = await collectWorkspaceSnapshot(readers(), () => NOW);

  // A summary reader would yield "" here, which is what silently emptied the
  // ZIP export and dropped every note asset along with it.
  assert.equal(snapshot.vaultPages[0]?.body, "full body");
});

test("optional readers default to empty rather than throwing", async () => {
  const snapshot = await collectWorkspaceSnapshot(readers(), () => NOW);

  assert.deepEqual(snapshot.relations, []);
  assert.deepEqual(snapshot.tags, []);
  assert.deepEqual(snapshot.readingListItems, []);
});

test("reading-list membership is fetched for the collected list ids", async () => {
  let received: readonly string[] = [];
  const snapshot = await collectWorkspaceSnapshot(
    readers({
      readingListItems: {
        listItemsForLists: async (ids) => {
          received = ids;
          return [{ listId: "l1", paperId: "p1" } as never];
        },
      },
    }),
    () => NOW,
  );

  assert.deepEqual(received, ["l1"]);
  assert.equal(snapshot.readingListItems.length, 1);
});

test("never reaches for a lossy summary reader when one is offered", async () => {
  // The failure this guards: a reader that also exposes `listSummaries()` — the
  // card projection, which returns `body: ""`. Picking it here is what emptied
  // the export. If someone "optimises" the snapshot onto summaries, this fails.
  let summariesCalled = false;
  const dualReader = {
    list: async () => [{ id: "n1", title: "Method", body: "full body" } as never],
    listSummaries: async () => {
      summariesCalled = true;
      return [{ id: "n1", title: "Method", body: "" } as never];
    },
  };

  const snapshot = await collectWorkspaceSnapshot(readers({ vaultPages: dualReader }), () => NOW);

  assert.equal(summariesCalled, false, "snapshot called the lossy summary reader");
  assert.equal(snapshot.vaultPages[0]?.body, "full body");
});

test("counts summarise the snapshot for the export manifest", async () => {
  const snapshot = await collectWorkspaceSnapshot(readers(), () => NOW);

  assert.deepEqual(workspaceSnapshotCounts(snapshot), {
    papers: 1,
    notes: 1,
    readingLists: 1,
    reportSections: 0,
    experiments: 0,
    milestones: 0,
    logEntries: 0,
    relations: 0,
    tags: 0,
  });
});
