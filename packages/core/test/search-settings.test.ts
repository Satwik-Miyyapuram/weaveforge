import assert from "node:assert/strict";
import test from "node:test";
import {
  DOWNRANK_FACTOR,
  FIELD_BOOSTS,
  MAX_FIELD_WEIGHT,
  documentBoost,
  effectiveFieldBoosts,
  forgetSearchQuery,
  kindMultiplier,
  normalizeSearchHistory,
  normalizeSearchSettings,
  rememberSearchQuery,
  type SearchDoc,
} from "../src/index.js";

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

// -------------------------------------------------------------------- history

test("a repeated query moves to the front instead of duplicating", () => {
  const history = rememberSearchQuery(["latent", "graph"], "graph");

  assert.deepEqual(history, ["graph", "latent"]);
});

test("typing progressively does not fill history with prefixes", () => {
  let history: string[] = [];
  for (const q of ["att", "atten", "attention"]) history = rememberSearchQuery(history, q);

  assert.deepEqual(history, ["attention"]);
});

test("history is capped and ordered most-recent first", () => {
  let history: string[] = [];
  for (let i = 0; i < 20; i += 1) history = rememberSearchQuery(history, `query ${i}`, 5);

  assert.equal(history.length, 5);
  assert.equal(history[0], "query 19");
});

test("blank queries are not recorded", () => {
  assert.deepEqual(rememberSearchQuery(["latent"], "   "), ["latent"]);
});

test("entries can be forgotten case-insensitively", () => {
  assert.deepEqual(forgetSearchQuery(["Latent", "graph"], "latent"), ["graph"]);
});

test("stored history is normalized against junk", () => {
  assert.deepEqual(normalizeSearchHistory(["a", 3, "", "  b ", "A", null]), ["a", "b"]);
  assert.deepEqual(normalizeSearchHistory("not an array"), []);
});
