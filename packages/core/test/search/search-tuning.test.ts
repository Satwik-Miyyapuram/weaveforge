import assert from "node:assert/strict";
import test from "node:test";
import { type SearchDoc } from "../../src/index.js";
import { rust } from "../../src/shared/rust.js";

const NOW = Date.parse("2026-08-05T00:00:00.000Z");

function doc(overrides: Partial<SearchDoc> = {}): SearchDoc {
  return {
    id: "note:n1",
    kind: "note",
    entityId: "n1",
    title: "Method",
    aliases: [],
    headings: [],
    tags: [],
    path: "",
    body: "",
    updatedAt: "2026-08-05T00:00:00.000Z",
    href: "/notes?page=n1",
    degree: 0,
    ...overrides,
  };
}

test("fuzziness is graduated by term length", () => {
  // Short terms get none: at three characters most short words are one edit
  // apart, so fuzziness there returns noise rather than typo tolerance.
  assert.equal(rust().fuzzinessForTerm("vae"), 0);
  assert.equal(rust().fuzzinessForTerm("abc"), 0);
  assert.equal(rust().fuzzinessForTerm("graph"), 0.1);
  assert.equal(rust().fuzzinessForTerm("attention"), 0.2);
});

test("prefix matching needs at least three characters", () => {
  assert.equal(rust().MIN_PREFIX_LENGTH, 3);
});

test("title outranks every other field", () => {
  const boosts = rust().effectiveFieldBoosts();
  const others = (Object.keys(boosts) as (keyof typeof boosts)[]).filter(
    (f) => f !== "title",
  );
  for (const field of others) {
    assert.ok(boosts.title > boosts[field], `title should outrank ${field}`);
  }
  assert.ok(boosts.body < boosts.headings);
});

test("link degree beats recency — the deliberate deviation from Omnisearch", () => {
  // A heavily-cited old paper must not lose to yesterday's scratch note.
  const oldHub = doc({ degree: 15, updatedAt: "2017-06-12T00:00:00.000Z" });
  const freshOrphan = doc({ degree: 0, updatedAt: "2026-08-04T00:00:00.000Z" });

  assert.ok(
    rust().documentBoost(oldHub, { now: NOW }) > rust().documentBoost(freshOrphan, { now: NOW }),
    "a well-linked old document should outrank a fresh unlinked one",
  );
});

test("recency only orders documents of equal degree", () => {
  const recent = doc({ degree: 3, updatedAt: "2026-08-04T00:00:00.000Z" });
  const stale = doc({ degree: 3, updatedAt: "2020-01-01T00:00:00.000Z" });

  assert.ok(rust().documentBoost(recent, { now: NOW }) > rust().documentBoost(stale, { now: NOW }));
});

test("the recency component is bounded so it cannot overturn a better match", () => {
  const brandNew = doc({ degree: 0, updatedAt: "2026-08-05T00:00:00.000Z" });
  const ancient = doc({ degree: 0, updatedAt: "1999-01-01T00:00:00.000Z" });

  const ratio = rust().documentBoost(brandNew, { now: NOW }) / rust().documentBoost(ancient, { now: NOW });
  assert.ok(ratio <= 1.16, `recency swing should stay within ~15%, got ${ratio}`);
});

test("degree growth saturates so hubs cannot dominate outright", () => {
  const gain = (from: number, to: number) =>
    rust().documentBoost(doc({ degree: to }), { now: NOW }) /
    rust().documentBoost(doc({ degree: from }), { now: NOW });

  assert.ok(gain(0, 5) > gain(60, 65), "equal link deltas should matter less as degree grows");
});

test("an unparseable timestamp falls back to the degree signal alone", () => {
  const broken = doc({ degree: 4, updatedAt: "not-a-date" });

  const boost = rust().documentBoost(broken, { now: NOW });
  assert.ok(Number.isFinite(boost));
  assert.ok(boost > 1);
});
