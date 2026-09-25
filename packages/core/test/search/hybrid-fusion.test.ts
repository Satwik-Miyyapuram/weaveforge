import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coveredHits, gateVectorHits, queryTermCount, stripStopwords } from "../../src/index.js";

describe("stripStopwords", () => {
  it("drops function words", () => {
    assert.equal(stripStopwords("how to train a very deep image classifier"), "train very deep image classifier");
  });
  it("keeps a query made only of stopwords", () => {
    assert.equal(stripStopwords("the which"), "the which");
  });
  it("leaves filters, exclusions and phrases alone", () => {
    assert.equal(stripStopwords('kind:paper the -of "state of the art"'), 'kind:paper -of "state of the art"');
  });
});

describe("coveredHits", () => {
  const hits = [
    { id: "a", queryTerms: ["residual", "networks"] },
    { id: "b", queryTerms: ["networks"] },
    { id: "c", queryTerms: ["networks"] },
    { id: "d" },
  ];
  it("keeps hits matching at least half the terms, and hits that do not say", () => {
    assert.deepEqual(coveredHits(hits, 3).map((h) => h.id), ["a", "d"]);
  });
  it("filters nothing for a one-term query", () => {
    assert.equal(coveredHits(hits, 1).length, 4);
  });
  it("counts distinct terms", () => {
    assert.equal(queryTermCount("Residual residual networks"), 2);
  });
});

describe("gateVectorHits", () => {
  const hits = [0.5, 0.3, 0.2, 0.1, 0.05, 0.04, 0.35].map((score, i) => ({ id: String(i), score }));
  it("returns nothing when the best hit is under the floor", () => {
    assert.deepEqual(gateVectorHits(hits.slice(1), 0.4), []);
  });
  it("keeps the top few plus anything above the floor", () => {
    assert.deepEqual(gateVectorHits(hits, 0.28, 3).map((h) => h.id), ["0", "1", "2", "6"]);
  });
});
