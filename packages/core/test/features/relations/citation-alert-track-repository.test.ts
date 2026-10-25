import assert from "node:assert/strict";
import test from "node:test";
import { runCitationAlertTrackRepositoryContract } from "../../../src/testing/citation-alert-track-repository-contract.js";
import { InMemoryCitationAlertTrackRepository } from "../../../src/testing/in-memory-citation-alert-track-repository.js";

runCitationAlertTrackRepositoryContract(
  "InMemory",
  () => new InMemoryCitationAlertTrackRepository(),
);

test("listForProject returns only the current scope's tracks (08-01)", async () => {
  const repo = new InMemoryCitationAlertTrackRepository("me", "proj-1");
  await repo.track({ paperId: "paper-1" });
  repo.setScope("me", "proj-2");
  assert.deepEqual(await repo.listForProject(), []);
  await repo.track({ paperId: "paper-2" });
  assert.deepEqual((await repo.listForProject()).map((t) => t.paperId), ["paper-2"]);
  repo.setScope("other", "proj-1");
  assert.deepEqual(await repo.listForProject(), []);
  repo.setScope("me", "proj-1");
  assert.deepEqual((await repo.listForProject()).map((t) => t.paperId), ["paper-1"]);
});
