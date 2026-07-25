import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGraphPersistedState } from "../src/features/relations/domain/graph-persisted-state.js";
import { DEFAULT_GRAPH_SETTINGS } from "../src/features/relations/domain/graph-view-settings.js";

test("parseGraphPersistedState returns null for absent payloads", () => {
  assert.equal(parseGraphPersistedState(null), null);
  assert.equal(parseGraphPersistedState(undefined), null);
});

test("parseGraphPersistedState returns defaults for empty object", () => {
  const parsed = parseGraphPersistedState({});
  assert.deepEqual(parsed?.settings, DEFAULT_GRAPH_SETTINGS);
  assert.deepEqual(parsed?.selectedLists, []);
  assert.deepEqual(parsed?.selectedTags, []);
  assert.equal(parsed?.localSeed, null);
  assert.equal(parsed?.localDepth, 2);
  assert.deepEqual(parsed?.pinned, {});
});

test("parseGraphPersistedState sanitizes invalid fields", () => {
  const parsed = parseGraphPersistedState({
    settings: { edgeMode: "nope", colorBy: "tag", relationTypes: ["cites", "bad"] },
    selectedLists: ["a", 1, null],
    localDepth: 0,
    pinned: { n1: { x: 1, y: 2 }, bad: "x" },
  });
  assert.equal(parsed?.settings.edgeMode, DEFAULT_GRAPH_SETTINGS.edgeMode);
  assert.equal(parsed?.settings.colorBy, "tag");
  assert.deepEqual(parsed?.settings.relationTypes, ["cites"]);
  assert.deepEqual(parsed?.selectedLists, ["a"]);
  assert.equal(parsed?.localDepth, 2);
  assert.deepEqual(parsed?.pinned, { n1: { x: 1, y: 2 } });
});
