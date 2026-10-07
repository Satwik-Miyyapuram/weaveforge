import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGraphPersistedState } from "../../../src/features/relations/domain/graph-persisted-state.js";
import { DEFAULT_GRAPH_SETTINGS, normalizeGraphViewSettings } from "../../../src/features/relations/domain/graph-view-settings.js";

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

test("node colours keep valid hex overrides and drop the rest", () => {
  const parsed = normalizeGraphViewSettings({
    nodePalette: "neon",
    nodeColors: { note: "#FF00AA", reading: "red", tag: "#123456", experiment: 12 },
  });
  assert.equal(parsed.nodePalette, DEFAULT_GRAPH_SETTINGS.nodePalette);
  assert.deepEqual(parsed.nodeColors, { note: "#ff00aa" });
  assert.equal(normalizeGraphViewSettings({ nodePalette: "classic" }).nodePalette, "classic");
});

test("colour groups keep valid rules, capped, and new colour modes survive", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ query: `tag:t${i}`, color: "#AABBCC" }));
  const parsed = normalizeGraphViewSettings({
    colorBy: "cluster",
    colorGroups: [{ query: "tag:ml", color: "#E4572E" }, { query: "x", color: "blue" }, null, ...many],
  });
  assert.equal(parsed.colorBy, "cluster");
  assert.equal(parsed.colorGroups.length, 12);
  assert.deepEqual(parsed.colorGroups[0], { query: "tag:ml", color: "#e4572e" });
  assert.deepEqual(normalizeGraphViewSettings({ colorGroups: "nope" }).colorGroups, []);
  assert.equal(normalizeGraphViewSettings({ colorBy: "rainbow" }).colorBy, "status");
});

test("includeListsAsConcepts and boundedZoomScale sanitize properly", () => {
  const defaults = normalizeGraphViewSettings({});
  assert.equal(defaults.includeListsAsConcepts, true);
  assert.equal(defaults.boundedZoomScale, true);

  const disabled = normalizeGraphViewSettings({
    includeListsAsConcepts: false,
    boundedZoomScale: false,
  });
  assert.equal(disabled.includeListsAsConcepts, false);
  assert.equal(disabled.boundedZoomScale, false);

  const invalid = normalizeGraphViewSettings({
    includeListsAsConcepts: "invalid",
    boundedZoomScale: 42,
  });
  assert.equal(invalid.includeListsAsConcepts, true);
  assert.equal(invalid.boundedZoomScale, true);
});

