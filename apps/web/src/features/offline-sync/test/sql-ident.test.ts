/** One SQL identifier quoter for the device database (xhelp-22). */

import assert from "node:assert/strict";
import { before, test } from "node:test";

import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

test("an identifier is double-quoted", () => {
  assert.equal(readyCore().quoteIdent("papers"), '"papers"');
  assert.equal(readyCore().quoteIdent(""), '""');
});

test("an embedded double quote is doubled, so it cannot close the identifier", () => {
  assert.equal(readyCore().quoteIdent('a"b'), '"a""b"');
  assert.equal(readyCore().quoteIdent('x"; drop table y; --'), '"x""; drop table y; --"');
});
