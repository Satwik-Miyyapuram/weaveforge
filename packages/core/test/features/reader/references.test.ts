import { test } from "node:test";
import assert from "node:assert/strict";
import * as wasm from "../../../../wf-wasm/src/index.ts";
import type { CoreContract } from "../../../src/index.js";

// Their TypeScript was removed; the Rust core is the implementation.
const { isBibliographicMatch, titleSimilarity } = wasm as unknown as CoreContract;

test("title scorer enforces title and year thresholds", () => {
  assert.equal(titleSimilarity("Müller: A method", "a method muller"), 1);
  assert.equal(titleSimilarity("", ""), 0);
  assert.equal(isBibliographicMatch({ title: "A useful method", year: 2020 }, { title: "A useful method", year: 2021 }), true);
  assert.equal(isBibliographicMatch({ title: "A useful method", year: 2020 }, { title: "A useful method", year: 2022 }), false);
  assert.equal(isBibliographicMatch({ title: "A useful method" }, { title: "A completely different method" }), false);
});
