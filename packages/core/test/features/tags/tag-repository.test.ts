import assert from "node:assert/strict";
import test from "node:test";
import { runTagRepositoryContract } from "../../../src/testing/tag-repository-contract.js";
import {
  InMemoryTagRepository,
  InMemoryPaperTagRepository,
} from "../../../src/testing/in-memory-tag-repository.js";

runTagRepositoryContract("InMemory", () => {
  const paperTags = new InMemoryPaperTagRepository();
  return { tags: new InMemoryTagRepository(paperTags), paperTags };
});

test("listWithCounts without a paper-tag repository throws instead of reporting zeros (08-11)", async () => {
  const tags = new InMemoryTagRepository();
  await tags.save({ id: "t1", name: "ml" });
  await assert.rejects(tags.listWithCounts(), /paperTags/);
  // The rest of the repository works without it.
  assert.equal((await tags.list()).length, 1);
});
