import assert from "node:assert/strict";
import test from "node:test";
import {
  DOWNRANK_FACTOR,
  documentBoost,
  effectiveFieldBoosts,
  normalizeSearchSettings,
  normalizeUserSettings,
  type SearchDoc,
} from "../../../src/index.js";

/**
 * Ranking preferences have to survive the round trip through persisted user
 * settings. They were previously applied only when the settings screen saved,
 * so a saved weight was silently ignored on every fresh load — the failure this
 * covers is a preference that appears to work and does not.
 */

const doc = (over: Partial<SearchDoc> = {}): SearchDoc => ({
  id: "note:n1", kind: "note", entityId: "n1", title: "T", aliases: [], headings: [],
  tags: [], path: "", body: "", updatedAt: "2026-08-01T00:00:00.000Z",
  href: "/notes?page=n1", degree: 0, ...over,
});

test("search settings survive normalization into the user settings record", () => {
  const saved = normalizeUserSettings({
    search: { weights: { body: 12 }, downrankedKinds: ["log"], recencyBoost: false },
  });

  assert.equal(saved.search?.weights?.body, 12);
  assert.deepEqual(saved.search?.downrankedKinds, ["log"]);
  assert.equal(saved.search?.recencyBoost, false);
});

test("a settings record with no search preferences stays absent rather than empty", () => {
  assert.equal(normalizeUserSettings({}).search, undefined);
  assert.equal(normalizeUserSettings({ search: {} }).search, undefined);
});

test("junk in the stored record cannot reach the ranker", () => {
  const saved = normalizeUserSettings({
    search: { weights: { title: 1e9, bogus: 3 }, downrankedKinds: ["nonsense"] },
  } as never);

  assert.equal(saved.search?.weights?.title, 20, "clamped to the maximum");
  assert.equal((saved.search?.weights as Record<string, number>).bogus, undefined);
  assert.equal(saved.search?.downrankedKinds, undefined, "an unknown kind leaves nothing behind");
});

test("loaded settings actually change scoring", () => {
  const settings = normalizeSearchSettings({ downrankedKinds: ["note"], recencyBoost: false });

  const sunk = documentBoost(doc({ degree: 4 }), {
    kindMultiplier: settings?.downrankedKinds?.includes("note") ? DOWNRANK_FACTOR : 1,
    recency: settings?.recencyBoost,
  });
  const normal = documentBoost(doc({ degree: 4 }));

  assert.ok(sunk < normal, "a loaded downrank preference must actually sink the kind");
  assert.equal(effectiveFieldBoosts(settings).title, 8, "untouched fields keep their default");
});
