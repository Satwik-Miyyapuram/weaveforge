import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { mock } from "node:test";

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
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath(dir), old, old);
  acquireDbLock(dir, "WeaveForge");
  fs.writeFileSync(lockPath(dir), holder(process.ppid));
  releaseDbLock(dir);
  assert.equal(fs.existsSync(lockPath(dir)), true);
});

test("local-db-lock: a just-created lock not yet written is not taken over (37-02)", () => {
  const dir = dataDir();
  fs.writeFileSync(lockPath(dir), "");
  assert.throws(() => acquireDbLock(dir, "WeaveForge"), DatabaseInUseError);
  assert.equal(fs.readFileSync(lockPath(dir), "utf8"), "", "left untouched");
});

test("local-db-lock: a fresh lock that replaced the stale one mid-takeover survives (37-02)", () => {
  const dir = dataDir();
  const file = lockPath(dir);
  fs.writeFileSync(file, holder(deadPid()));
  // Another process takes the stale lock over right after we read it.
  const real = fs.readFileSync;
  let raced = false;
  const read = mock.method(fs, "readFileSync", ((p: fs.PathOrFileDescriptor, o?: unknown) => {
    const out = real(p, o as BufferEncoding);
    if (!raced && p === file) {
      raced = true;
      fs.rmSync(file);
      fs.writeFileSync(file, holder(process.ppid));
    }
    return out;
  }) as typeof fs.readFileSync);
  try {
    assert.throws(() => acquireDbLock(dir, "WeaveForge"), DatabaseInUseError);
  } finally {
    read.mock.restore();
  }
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).pid, process.ppid, "the racer keeps its lock");
  assert.deepEqual(
    fs.readdirSync(path.dirname(file)).filter((f) => f !== path.basename(file)),
    [],
    "no leftover files",
  );
});
