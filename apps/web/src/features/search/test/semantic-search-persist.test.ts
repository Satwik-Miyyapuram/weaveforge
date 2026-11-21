/**
 * The debounced vector save after a sync stores under the project the sync was
 * for: a project switch inside the 5 s wait must not file A's vectors under B
 * (P2-232).
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { createSyncPersister } from "../application/semantic-search";

function harness() {
  const index = { ready: true, serialize: () => ({ dim: 3 }) };
  const state = { index: index as typeof index | null, projectId: "A" as string | null };
  const saved: { projectId: string | null; revision: string }[] = [];
  const persister = createSyncPersister({
    current: () => state,
    projection: async () => ["doc"],
    revision: (docs) => `rev-${docs.length}`,
    save: async (projectId, value) => { saved.push({ projectId, revision: value.revision }); },
    delayMs: 5_000,
  });
  return { index, state, saved, persister };
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

test("a sync saves under its project after the delay", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const h = harness();
    h.persister.schedule();
    mock.timers.tick(5_000);
    await settle();
    assert.deepEqual(h.saved, [{ projectId: "A", revision: "rev-1" }]);
  } finally {
    mock.timers.reset();
  }
});

test("a project switch during the wait saves nothing under the new project (P2-232)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const h = harness();
    h.persister.schedule();
    h.state.projectId = "B";
    h.state.index = { ready: true, serialize: () => ({ dim: 3 }) };
    mock.timers.tick(5_000);
    await settle();
    assert.ok(!h.saved.some((s) => s.projectId === "B"), "B's id got A's vectors");
  } finally {
    mock.timers.reset();
  }
});

test("cancel drops a pending save", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const h = harness();
    h.persister.schedule();
    h.persister.cancel();
    mock.timers.tick(5_000);
    await settle();
    assert.deepEqual(h.saved, []);
  } finally {
    mock.timers.reset();
  }
});
