import assert from "node:assert/strict";
import test, { before } from "node:test";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(loadTestCore);

test("counts distinct wikilinks and citekeys", () => {
  const body = "As [[Meng 2022]] shows [@smith2020; @doe_21], and [[meng 2022|again]] @smith2020.";
  assert.equal(readyCore().countSectionSources(body), 3);
});

test("ignores emails and empty bodies", () => {
  assert.equal(readyCore().countSectionSources("mail me at a@b.com"), 0);
  assert.equal(readyCore().countSectionSources(undefined), 0);
});
