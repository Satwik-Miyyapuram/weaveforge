// Static checks for 0164: shared_docs accepts kind 'item', profiles gets the
// 0.9.7 export marker, and the rollback puts both back. No SQL is run here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const forward = readFileSync(join(root, "db/migrations/0164_shared_item_snapshot.sql"), "utf8");
const rollback = readFileSync(join(root, "db/migrations-rollback/0164_shared_item_snapshot.sql"), "utf8");
const original = readFileSync(join(root, "db/migrations/0161_files_first_server.sql"), "utf8");

/** The kind list of a `kind in (...)` check, as sorted names. */
function kindList(sql) {
  const match = sql.match(/check\s*\(\s*kind\s+in\s*\(([^)]*)\)\s*\)/i);
  assert.ok(match, "a kind check is present");
  return match[1]
    .split(",")
    .map((part) => part.trim().replace(/^'|'$/g, ""))
    .sort();
}

test("0161 is the baseline: the old kind list has no item", () => {
  assert.deepEqual(kindList(original), ["annotations", "canvas", "feed", "note"]);
});

test("forward migration replaces the kind check with one that includes item", () => {
  assert.match(forward, /drop constraint if exists shared_docs_kind_check/i);
  assert.deepEqual(kindList(forward), ["annotations", "canvas", "feed", "item", "note"]);
});

test("forward migration adds the nullable profiles.exported_097_at marker", () => {
  assert.match(
    forward,
    /alter table profiles\s+add column if not exists exported_097_at timestamptz null/i,
  );
});

test("rollback restores the 0161 kind check exactly", () => {
  assert.match(rollback, /drop constraint if exists shared_docs_kind_check/i);
  assert.deepEqual(kindList(rollback), kindList(original));
  assert.doesNotMatch(kindList(rollback).join(","), /item/);
});

test("rollback drops the profiles.exported_097_at column", () => {
  assert.match(rollback, /alter table profiles\s+drop column if exists exported_097_at/i);
});
