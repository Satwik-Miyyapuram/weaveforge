/**
 * Shared items are read in one batch per kind, not one request each (33-17).
 *
 * The batch goes through the same repository as the single read did, so each
 * repository's scoping applies unchanged; a repository without a batch read
 * falls back to reading one at a time.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadSharedItemDetails } from "@/features/sharing/application/load-shared-details";
import type { SharedItem } from "@/features/sharing/domain/shared-reader";

type Row = { id: string; name?: string };

/** A repository that answers only for the ids it holds, and counts its calls. */
function repo(held: Row[], batch = true) {
  const calls = { getById: 0, listByIds: [] as string[][] };
  const byId = new Map(held.map((r) => [r.id, r]));
  const r: Record<string, unknown> = {
    getById: async (id: string) => {
      calls.getById += 1;
      return byId.get(id) ?? null;
    },
  };
  if (batch) {
    r.listByIds = async (ids: readonly string[]) => {
      calls.listByIds.push([...ids]);
      return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    };
  }
  return { repo: r as never, calls };
}

const item = (id: string, kind: SharedItem["kind"], ownerId = "other"): SharedItem => ({
  id,
  kind,
  title: `t-${id}`,
  status: "",
  ownerId,
});

test("load-shared-details batches and keeps other-owner scoping", async () => {
  // p3 is shared but the (scoped) repository does not return it: it stays
  // without a paper, exactly as a null getById left it.
  const papers = repo([{ id: "p1" }, { id: "p2" }]);
  const experiments = repo([{ id: "e1" }]);
  const vaultPages = repo([{ id: "v1" }]);
  const readingLists = repo([{ id: "l1", name: "List one" }]);
  const out = await loadSharedItemDetails(
    [
      item("p1", "paper"),
      item("p2", "paper", "someone-else"),
      item("p3", "paper"),
      item("p1", "paper"),
      item("e1", "experiment"),
      item("v1", "vault_page"),
      item("l1", "reading_list"),
    ],
    {
      papers: papers.repo,
      experiments: experiments.repo,
      vaultPages: vaultPages.repo,
      readingLists: readingLists.repo,
    },
  );
  assert.deepEqual(papers.calls.listByIds, [["p1", "p2", "p3"]], "one batch, ids deduplicated");
  assert.equal(papers.calls.getById, 0);
  assert.deepEqual(experiments.calls.listByIds, [["e1"]]);
  assert.deepEqual(vaultPages.calls.listByIds, [["v1"]]);
  assert.deepEqual(readingLists.calls.listByIds, [["l1"]]);
  assert.equal(out.length, 7);
  assert.equal(out[0]!.paper?.id, "p1");
  assert.equal(out[1]!.paper?.id, "p2");
  assert.equal(out[2]!.paper, undefined);
  assert.equal(out[3]!.paper?.id, "p1");
  assert.equal(out[4]!.experiment?.id, "e1");
  assert.equal(out[5]!.vaultPage?.id, "v1");
  assert.equal(out[6]!.title, "List one");
});

test("a kind with no shared items asks nothing", async () => {
  const papers = repo([]);
  const experiments = repo([]);
  const vaultPages = repo([]);
  await loadSharedItemDetails([], {
    papers: papers.repo,
    experiments: experiments.repo,
    vaultPages: vaultPages.repo,
  });
  assert.equal(papers.calls.listByIds.length + papers.calls.getById, 0);
  assert.equal(experiments.calls.listByIds.length + experiments.calls.getById, 0);
});

test("a repository without a batch read falls back to one read per id", async () => {
  const papers = repo([{ id: "p1" }], false);
  const out = await loadSharedItemDetails([item("p1", "paper"), item("p2", "paper")], {
    papers: papers.repo,
    experiments: repo([]).repo,
    vaultPages: repo([]).repo,
  });
  assert.equal(papers.calls.getById, 2);
  assert.equal(out[0]!.paper?.id, "p1");
  assert.equal(out[1]!.paper, undefined);
});
