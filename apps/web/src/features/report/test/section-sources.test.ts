import assert from "node:assert/strict";
import test from "node:test";
import { countSectionSources } from "../lib/section-sources";

test("counts distinct wikilinks and citekeys", () => {
  const body = "As [[Meng 2022]] shows [@smith2020; @doe_21], and [[meng 2022|again]] @smith2020.";
  assert.equal(countSectionSources(body), 3);
});

test("ignores emails and empty bodies", () => {
  assert.equal(countSectionSources("mail me at a@b.com"), 0);
  assert.equal(countSectionSources(undefined), 0);
});
