import assert from "node:assert/strict";
import { test } from "node:test";

import { matchesOnly, selectOnly } from "../migration-select.mjs";

test("--only that matches in both migration directories is ambiguous (P2-102)", () => {
  const base = ["0001_init.sql", "0025_tags.sql"];
  const selfHosted = ["0000_self_host_prereqs.sql", "0025_self_host_auth.sql"];
  assert.deepEqual(selectOnly([base, selfHosted], "25"), {
    names: ["0025_tags.sql", "0025_self_host_auth.sql"],
    ambiguous: true,
  });
  assert.deepEqual(selectOnly([base, selfHosted], "0025_self_host_auth"), {
    names: ["0025_self_host_auth.sql"],
    ambiguous: false,
  });
  assert.deepEqual(selectOnly([base, selfHosted], "1"), { names: ["0001_init.sql"], ambiguous: false });
  assert.deepEqual(selectOnly([base, selfHosted], "9"), { names: [], ambiguous: false });
});

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
