/**
 * A table file that is valid JSON but not a list of rows is refused with the
 * file's name (P2-258). It used to be cast straight to rows, so `{}` or `[1]`
 * failed later with an unrelated error, and `null` imported nothing.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { SYNC_TABLES, syncTableFile, syncTableRowsFromFolder } from "../application/sync-tables";

const table = SYNC_TABLES[0]!;
const file = syncTableFile(table);

for (const text of ["{}", "null", "[1]", "[[]]"]) {
  test(`a table file holding ${text} is refused by name (P2-258)`, () => {
    assert.throws(() => syncTableRowsFromFolder({ [file]: text }), (err: Error) => err.message.includes(file));
  });
}

test("an empty table file is still refused", () => {
  assert.throws(() => syncTableRowsFromFolder({ [file]: "" }));
});

test("a list of rows reads back", () => {
  assert.deepEqual(syncTableRowsFromFolder({ [file]: '[{"id":"a"}]' })[table], [{ id: "a" }]);
});