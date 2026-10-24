/**
 * The read memo in front of the paper repository.
 *
 * Every write must drop the memo, or the next read paints the row as it was
 * before the write. The narrow writes (`setTags`, `replaceSummary`) were added
 * to the port after the memo's write list was written, so they are checked
 * here one by one.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Paper } from "@weaveforge/core";
import { InMemoryPaperRepository } from "@weaveforge/core/testing";

import { cachePaperRepository } from "../cached-paper-repository";

const paper: Paper = {
  id: "p1",
  title: "T",
  authors: [],
  status: "to_read",
  tags: [],
  metadata: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  summary: "Old",
};

async function setup() {
  const inner = new InMemoryPaperRepository();
  await inner.save(paper);
  const repo = cachePaperRepository(inner, () => "project-1");
  assert.equal((await repo.getById("p1"))?.summary, "Old", "warm the memo");
  return repo;
}

test("setTags drops the memo, so the next read shows the new tags", async () => {
  const repo = await setup();
  await repo.setTags("p1", ["ml"], "2026-02-01T00:00:00.000Z");
  assert.deepEqual((await repo.getById("p1"))?.tags, ["ml"]);
});

test("replaceSummary drops the memo, so the next read shows the new summary", async () => {
  const repo = await setup();
  assert.equal(await repo.replaceSummary("p1", "Old", "New", "2026-02-01T00:00:00.000Z"), true);
  assert.equal((await repo.getById("p1"))?.summary, "New");
});

test("save and delete still drop the memo", async () => {
  const repo = await setup();
  await repo.save({ ...paper, summary: "Saved" });
  assert.equal((await repo.getById("p1"))?.summary, "Saved");
  await repo.delete("p1");
  assert.equal(await repo.getById("p1"), null);
});

test("a repeated read is served from the memo", async () => {
  const inner = new InMemoryPaperRepository();
  await inner.save(paper);
  let reads = 0;
  const getById = inner.getById.bind(inner);
  inner.getById = async (id) => {
    reads += 1;
    return getById(id);
  };
  const repo = cachePaperRepository(inner, () => "project-1");
  await repo.getById("p1");
  await repo.getById("p1");
  assert.equal(reads, 1);
});
