import assert from "node:assert/strict";
import { test } from "node:test";

import { matchesOnly } from "../migration-select.mjs";

const files = ["0011_a.sql", "0110_b.sql", "0114_c.sql", "1011_d.sql", "0025_self_host_auth.sql"];

test("--only with a number picks that migration number, not every name containing it (41-04)", () => {
  assert.deepEqual(files.filter((f) => matchesOnly(f, "011")), ["0011_a.sql"]);
  assert.deepEqual(files.filter((f) => matchesOnly(f, "0114")), ["0114_c.sql"]);
  assert.deepEqual(files.filter((f) => matchesOnly(f, "114")), ["0114_c.sql"]);
  assert.deepEqual(files.filter((f) => matchesOnly(f, "9999")), []);
});

test("--only with a name picks that file, with or without .sql (41-04)", () => {
  assert.deepEqual(files.filter((f) => matchesOnly(f, "0025_self_host_auth")), ["0025_self_host_auth.sql"]);
  assert.deepEqual(files.filter((f) => matchesOnly(f, "0025_self_host_auth.sql")), ["0025_self_host_auth.sql"]);
  assert.deepEqual(files.filter((f) => matchesOnly(f, "self_host")), []);
});

test("a file without a number never matches a number (41-04)", () => {
  assert.equal(matchesOnly("README.sql", "0"), false);
});
