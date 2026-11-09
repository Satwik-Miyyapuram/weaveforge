import assert from "node:assert/strict";
import test from "node:test";
import {
  DOWNRANK_FACTOR,
  FIELD_BOOSTS,
  MAX_FIELD_WEIGHT,
  documentBoost,
  effectiveFieldBoosts,
  kindMultiplier,
  normalizeSearchSettings,
  type SearchDoc,
} from "../../src/index.js";

const doc = (over: Partial<SearchDoc> = {}): SearchDoc => ({
  id: "note:n1", kind: "note", entityId: "n1", title: "T", aliases: [], headings: [],
  tags: [], path: "", body: "", updatedAt: "2026-08-01T00:00:00.000Z",
  href: "/notes?page=n1", degree: 0, ...over,
});

// ------------------------------------------------------------------- settings

test("overrides apply on top of the defaults", () => {
  const boosts = effectiveFieldBoosts({ weights: { body: 5 } });

  assert.equal(boosts.body, 5);
  assert.equal(boosts.title, FIELD_BOOSTS.title, "untouched fields keep their default");
});

test("weights are clamped — a stored value cannot break scoring", () => {
  const settings = normalizeSearchSettings({ weights: { title: 9_999, body: -4 } });

  assert.equal(settings?.weights?.title, MAX_FIELD_WEIGHT);
  assert.equal(settings?.weights?.body, 0);
});

test("unknown fields and kinds are dropped rather than trusted", () => {
  const settings = normalizeSearchSettings({
    weights: { title: 5, nonsense: 3 },
    downrankedKinds: ["log", "banana"],
  });

  assert.deepEqual(Object.keys(settings?.weights ?? {}), ["title"]);
  assert.deepEqual(settings?.downrankedKinds, ["log"]);
});

test("non-object input yields no settings instead of throwing", () => {
  assert.equal(normalizeSearchSettings(null), undefined);
  assert.equal(normalizeSearchSettings("nope"), undefined);
  assert.equal(normalizeSearchSettings([1, 2]), undefined);
  assert.equal(normalizeSearchSettings({}), undefined);
});

test("a downranked kind sinks without being excluded", () => {
  assert.equal(kindMultiplier("log", { downrankedKinds: ["log"] }), DOWNRANK_FACTOR);
  assert.equal(kindMultiplier("note", { downrankedKinds: ["log"] }), 1);

  const sunk = documentBoost(doc(), { kindMultiplier: DOWNRANK_FACTOR });
  const normal = documentBoost(doc());
  assert.ok(sunk < normal);
  assert.ok(sunk > 0, "downranking must not zero a document out of the results");
});

test("recency can be switched off", () => {
  const withRecency = documentBoost(doc(), { now: Date.parse("2026-08-02T00:00:00.000Z") });
  const without = documentBoost(doc(), { now: Date.parse("2026-08-02T00:00:00.000Z"), recency: false });

  assert.ok(withRecency > without, "the tiebreak should add something when on");
  assert.equal(without, 1, "with no links and no recency, the boost is neutral");
});
