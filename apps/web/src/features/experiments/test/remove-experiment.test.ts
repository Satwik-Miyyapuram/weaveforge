import assert from "node:assert/strict";
import test from "node:test";

import { removeExperiment } from "../application/parts";

test("the experiment is deleted first, then its local files", async () => {
  const calls: string[] = [];
  await removeExperiment(
    "exp-1",
    async (id) => void calls.push(`remove ${id}`),
    async (id) => void calls.push(`files ${id}`),
  );
  assert.deepEqual(calls, ["remove exp-1", "files exp-1"]);
});

test("a failed delete keeps the local files", async () => {
  const calls: string[] = [];
  await assert.rejects(
    removeExperiment(
      "exp-1",
      async () => {
        throw new Error("offline");
      },
      async (id) => void calls.push(`files ${id}`),
    ),
    /offline/,
  );
  assert.deepEqual(calls, []);
});

test("a failed clean-up does not fail the delete, and the web has none", async () => {
  await removeExperiment("exp-1", async () => {}, async () => {
    throw new Error("in use");
  });
  await removeExperiment("exp-1", async () => {});
});
