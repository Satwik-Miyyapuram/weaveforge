import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { mock } from "node:test";

import { clearRestoreLeftovers, restoreDirFor, restoreNewestGood } from "../src/local-db-restore";

function dataDir(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wf-restore-")), "db");
}

/** Unpacks by writing the backup's name; "bad" backups fail to open after unpacking. */
async function load(dir: string, file: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "from"), file);
  if (file.includes("bad")) throw new Error("could not locate a valid checkpoint record");
}

test("local-db-restore: a backup that does not open is skipped for the next older one", async () => {
  const dir = dataDir();
  const used = await restoreNewestGood(dir, ["new-bad", "mid-bad", "old-good"], load);
  assert.equal(used, "old-good");
  assert.equal(fs.readFileSync(path.join(dir, "from"), "utf8"), "old-good");
  assert.deepEqual(fs.readdirSync(path.dirname(dir)), ["db"], "no scratch left behind");
});

test("local-db-restore: a scratch that cannot be removed does not stop the fall-through", async (t) => {
  const dir = dataDir();
  const rm = fs.rmSync;
  // What Windows did on 2026-10-08 after PGlite aborted mid-load.
  t.after(() => mock.restoreAll());
  mock.method(fs, "rmSync", (p: fs.PathLike, o?: fs.RmOptions) => {
    if (String(p).includes(".restore-")) throw Object.assign(new Error("ENOTEMPTY"), { code: "ENOTEMPTY" });
    rm(p, o);
  });
  assert.equal(await restoreNewestGood(dir, ["new-bad", "old-good"], load), "old-good");
  assert.equal(fs.readFileSync(path.join(dir, "from"), "utf8"), "old-good");
});

test("local-db-restore: none open, nothing is created", async () => {
  const dir = dataDir();
  assert.equal(await restoreNewestGood(dir, ["a-bad", "b-bad"], load), null);
  assert.deepEqual(fs.readdirSync(path.dirname(dir)), []);
});

test("local-db-restore: never restores over an existing directory", async () => {
  const dir = dataDir();
  fs.mkdirSync(dir);
  await assert.rejects(restoreNewestGood(dir, ["good"], load), /refusing/);
});

test("local-db-restore: scratch from a crashed restore is cleared, siblings are not", () => {
  const dir = dataDir();
  fs.mkdirSync(restoreDirFor(dir), { recursive: true });
  fs.mkdirSync(`${dir}.broken-2026-10-08T12-00-00-000`);
  fs.mkdirSync(dir);
  clearRestoreLeftovers(dir);
  assert.deepEqual(fs.readdirSync(path.dirname(dir)).sort(), ["db", "db.broken-2026-10-08T12-00-00-000"]);
});
