import { test } from "node:test";
import assert from "node:assert/strict";
import type { GraphPersistedState } from "../features/relations/domain/graph-persisted-state.js";
import { DEFAULT_GRAPH_PERSISTED_STATE } from "../features/relations/domain/graph-persisted-state.js";
import type { IGraphSettingsRepository } from "../features/relations/domain/graph-settings-repository.js";

const sampleState = (): GraphPersistedState => ({
  ...DEFAULT_GRAPH_PERSISTED_STATE,
  selectedLists: ["list-1"],
  selectedTags: ["ml"],
  localSeed: "paper-1",
  localDepth: 3,
  pinned: { "paper-1": { x: 10, y: 20 } },
});

export function runGraphSettingsRepositoryContract(
  label: string,
  makeRepo: () => IGraphSettingsRepository,
): void {
  test(`[${label}] get returns null when absent`, async () => {
    const repo = makeRepo();
    assert.equal(await repo.get("missing"), null);
  });

  test(`[${label}] save then get round-trips`, async () => {
    const repo = makeRepo();
    const state = sampleState();
    await repo.save("p1", state);
    const found = await repo.get("p1");
    assert.deepEqual(found, state);
  });

  test(`[${label}] save overwrites prior state`, async () => {
    const repo = makeRepo();
    await repo.save("p1", sampleState());
    const next = sampleState();
    next.localDepth = 5;
    await repo.save("p1", next);
    const found = await repo.get("p1");
    assert.equal(found?.localDepth, 5);
  });
}
