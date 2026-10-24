/** One SQL identifier quoter for the device database (xhelp-22). */

import assert from "node:assert/strict";
import { test } from "node:test";

import { quoteIdent } from "../domain/sql-ident";

test("an identifier is double-quoted", () => {
  assert.equal(quoteIdent("papers"), '"papers"');
  assert.equal(quoteIdent(""), '""');
});

test("an embedded double quote is doubled, so it cannot close the identifier", () => {
  assert.equal(quoteIdent('a"b'), '"a""b"');
  assert.equal(quoteIdent('x"; drop table y; --'), '"x""; drop table y; --"');
});
