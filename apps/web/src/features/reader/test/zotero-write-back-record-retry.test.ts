/**
 * A Zotero annotation that was created is recorded, even when the first
 * attempt to store its key fails (P2-163). Without the key the next sync
 * creates the annotation in Zotero again.
 */
import assert from "node:assert/strict";
import test, { before } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";

import type { Paper } from "@weaveforge/core";
import { InMemoryReaderAnnotationRepository } from "@core-test/in-memory";
import { writeBackZoteroAnnotations, type ZoteroAnnotationPusher } from "../application/parts-3";

before(async () => {
  await loadTestCore();
});

const paper = { id: "p1", title: "p1", metadata: {} } as unknown as Paper;

const pusher: ZoteroAnnotationPusher = {
  push: async (_parent, anns) => ({
    results: anns.map((a) => ({ id: a.id, outcome: "created" as const, zoteroKey: "ZNEW", zoteroVersion: 4 })),
  }),
};

async function repoFailing(times: number) {
  const repo = new InMemoryReaderAnnotationRepository();
  await repo.create("p1", {
    type: "highlight", color: "#ffd400", anchor: { zoteroPosition: { pageIndex: 0 } }, pageIndex: 0,
  });
  let left = times;
  const record = repo.recordZoteroSync.bind(repo);
  repo.recordZoteroSync = async (...args) => {
    if (left > 0) {
      left -= 1;
      throw new Error("network down");
    }
    return record(...args);
  };
  return repo;
}

test("a key that fails to record once is recorded on retry", async () => {
  const repo = await repoFailing(1);
  const summary = await writeBackZoteroAnnotations({
    papers: [paper], attachmentOf: () => "ATT1", annotations: repo, pusher,
  });
  assert.deepEqual(summary, { created: 1, updated: 0, conflicts: 0, failed: 0 });
  const [row] = await repo.list("p1");
  assert.equal(row!.zoteroKey, "ZNEW");
});

test("a key that never records is counted as a failure with its reason", async () => {
  const repo = await repoFailing(100);
  const summary = await writeBackZoteroAnnotations({
    papers: [paper], attachmentOf: () => "ATT1", annotations: repo, pusher,
  });
  assert.equal(summary.created, 0);
  assert.equal(summary.failed, 1);
  assert.equal(summary.firstError, "network down");
});
