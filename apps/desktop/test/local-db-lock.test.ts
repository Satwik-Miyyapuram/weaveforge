import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireDbLock, DatabaseInUseError, lockPath, releaseDbLock } from "../src/local-db-lock";

function dataDir(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wf-lock-")), "db");
}

function holder(pid: number, at = new Date()) {
  return JSON.stringify({ pid, app: "WeaveForge Dev", at: at.toISOString() });
}

/** A pid that existed and has exited. */
function deadPid(): number {
  return spawnSync(process.execPath, ["-e", "0"]).pid!;
}

test("local-db-lock: a second live process is refused, naming the holder", () => {
  const dir = dataDir();
  // The parent process is alive for the whole test and is not us.
  fs.writeFileSync(lockPath(dir), holder(process.ppid));
  assert.throws(
    () => acquireDbLock(dir, "WeaveForge"),
    (e: unknown) => e instanceof DatabaseInUseError && /WeaveForge Dev \(pid \d+\)/.test(e.message),
  );
  assert.equal(JSON.parse(fs.readFileSync(lockPath(dir), "utf8")).pid, process.ppid, "left untouched");
});

test("local-db-lock: taken, re-taken by the same process, released", () => {
  const dir = dataDir();
  acquireDbLock(dir, "WeaveForge");
  acquireDbLock(dir, "WeaveForge");
  assert.equal(JSON.parse(fs.readFileSync(lockPath(dir), "utf8")).pid, process.pid);
  releaseDbLock(dir);
  assert.equal(fs.existsSync(lockPath(dir)), false);
});

test("local-db-lock: a lock whose process has exited is taken over", () => {
  const dir = dataDir();
  fs.writeFileSync(lockPath(dir), holder(deadPid()));
  acquireDbLock(dir, "WeaveForge");
  assert.equal(JSON.parse(fs.readFileSync(lockPath(dir), "utf8")).pid, process.pid);
});

test("local-db-lock: a lock from before this boot is taken over even if its pid is reused", () => {
  const dir = dataDir();
  const beforeBoot = new Date(Date.now() - (os.uptime() + 60) * 1000);
  fs.writeFileSync(lockPath(dir), holder(process.ppid, beforeBoot));
  acquireDbLock(dir, "WeaveForge");
  assert.equal(JSON.parse(fs.readFileSync(lockPath(dir), "utf8")).pid, process.pid);
});

test("local-db-lock: an unreadable lock is taken over; someone else's is never released", () => {
  const dir = dataDir();
  fs.writeFileSync(lockPath(dir), "garbage");
  acquireDbLock(dir, "WeaveForge");
  fs.writeFileSync(lockPath(dir), holder(process.ppid));
  releaseDbLock(dir);
  assert.equal(fs.existsSync(lockPath(dir)), true);
});
