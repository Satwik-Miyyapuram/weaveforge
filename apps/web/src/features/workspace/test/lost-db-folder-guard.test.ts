import assert from "node:assert/strict";
import { test } from "node:test";

import { folderWriteBlockedByLostDb } from "../application/folder-lost-db-guard";

test("a database recreated empty blocks folder writes", () => {
  assert.equal(folderWriteBlockedByLostDb({ recreatedEmpty: true }), true);
});

test("a healthy or unreported database does not block folder writes", () => {
  assert.equal(folderWriteBlockedByLostDb({ recreatedEmpty: false }), false);
  assert.equal(folderWriteBlockedByLostDb({}), false);
  assert.equal(folderWriteBlockedByLostDb(null), false);
  assert.equal(folderWriteBlockedByLostDb(undefined), false);
});
