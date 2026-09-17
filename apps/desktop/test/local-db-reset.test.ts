import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyDeferredMove, asidePath, markerPath, moveAside } from "../src/local-db-reset";

/**
 * Moving a database directory aside, on a real filesystem.
 *
 * Real rather than stubbed because what matters is what `rename` does to a
 * directory with contents, and that a deferred move is applied by a later
 * boot exactly as it was written down — both of which are the filesystem's
 * behaviour, not this module's.
 */

function scratch(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wf-reset-"));
  const dataDir = path.join(root, "local-db");
  fs.mkdirSync(path.join(dataDir, "base"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "PG_VERSION"), "17\n");
  return dataDir;
}

test("local-db-reset: the aside name is a sortable sibling that names the moment", () => {
  const at = new Date("2026-09-11T21:03:04.500Z");
  assert.equal(asidePath("/data/local-db", at), "/data/local-db.broken-2026-09-11T21-03-04-500");
});

test("local-db-reset: a directory that can be renamed is renamed, contents intact", async () => {
  const dataDir = scratch();
  const at = new Date("2026-09-11T21:03:04.500Z");
  assert.equal(await moveAside(dataDir, at), "moved");
  assert.equal(fs.existsSync(dataDir), false);
  assert.equal(fs.readFileSync(path.join(asidePath(dataDir, at), "PG_VERSION"), "utf8"), "17\n");
  assert.equal(fs.existsSync(markerPath(dataDir)), false);
});

test("local-db-reset: a directory that is already gone counts as moved", async () => {
  const dataDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wf-reset-")), "local-db");
  assert.equal(await moveAside(dataDir), "moved");
});

test("local-db-reset: a deferred move is applied at the next boot, then forgotten", () => {
  const dataDir = scratch();
  const target = asidePath(dataDir, new Date("2026-09-11T21:03:04.500Z"));
  fs.writeFileSync(markerPath(dataDir), target);

  applyDeferredMove(dataDir);

  assert.equal(fs.existsSync(dataDir), false);
  assert.equal(fs.readFileSync(path.join(target, "PG_VERSION"), "utf8"), "17\n");
  assert.equal(fs.existsSync(markerPath(dataDir)), false);
  // Idempotent: nothing to do, nothing thrown.
  applyDeferredMove(dataDir);
});

test("local-db-reset: a marker naming somewhere else is discarded, not obeyed", () => {
  const dataDir = scratch();
  fs.writeFileSync(markerPath(dataDir), path.join(os.tmpdir(), "somewhere-else"));

  applyDeferredMove(dataDir);

  assert.equal(fs.existsSync(dataDir), true);
  assert.equal(fs.existsSync(markerPath(dataDir)), false);
});
