// Static checks for 0164: shared_docs accepts kind 'item', profiles gets the
// 0.9.7 export marker, only mark_exported_097() may set it, and the rollback
// restores the kind check and removes the RPC. No SQL is run here.
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

test("forward migration revokes direct UPDATE of the marker from signed-in and anon", () => {
  assert.match(forward, /revoke update \(exported_097_at\) on profiles from authenticated, anon;/);
});

test("forward migration guards the marker with a trigger", () => {
  assert.match(forward, /create trigger profiles_guard_export_marker/i);
  assert.match(forward, /raise exception 'exported_097_at is set only by mark_exported_097\(\)'/);
});

test("mark_exported_097 is security definer, pins search_path, stamps auth.uid() only", () => {
  assert.match(forward, /create or replace function mark_exported_097\(\)/i);
  assert.match(forward, /security definer\s+set search_path = public/i);
  assert.match(forward, /where user_id = auth\.uid\(\)/);
  assert.match(forward, /if auth\.uid\(\) is null then/);
  assert.match(forward, /revoke all on function mark_exported_097\(\) from public, anon;/);
  assert.match(forward, /grant execute on function mark_exported_097\(\) to authenticated;/);
});

test("rollback restores the 0161 kind check exactly", () => {
  assert.match(rollback, /drop constraint if exists shared_docs_kind_check/i);
  assert.deepEqual(kindList(rollback), kindList(original));
  assert.doesNotMatch(kindList(rollback).join(","), /item/);
});

test("rollback drops the RPC and its guard trigger", () => {
  assert.match(rollback, /drop function if exists mark_exported_097\(\)/);
  assert.match(rollback, /drop trigger if exists profiles_guard_export_marker on profiles/);
});

test("rollback keeps the profiles.exported_097_at column", () => {
  assert.doesNotMatch(rollback, /drop column/i);
});

test("rollback header carries the exact pre-check query", () => {
  assert.match(rollback, /select item_id, owner from shared_docs where kind = 'item';/);
});
