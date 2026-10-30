import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MIGRATED_MARKER } from "../../../desktop/src/migrated-notice";
import {
  DONE_MARKER,
  ITEMS,
  migrateFromElectron,
  type MigrateOptions,
} from "../src/migrate";

const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const NOW = new Date("2026-10-30T08:00:00.000Z");

interface Dirs {
  root: string;
  old: string;
  new: string;
}

/** A fresh temp root with an empty `old/` and a `new/` that does not exist yet. */
function dirs(): Dirs {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wf-migrate-"));
  roots.push(root);
  const old = path.join(root, "old");
  fs.mkdirSync(old);
  return { root, old, new: path.join(root, "new") };
}

function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

/** Electron-like data: every item the migration copies, plus the sealed secrets file. */
function seedOld(old: string): void {
  write(path.join(old, "local-db", "PG_VERSION"), "17");
  write(path.join(old, "local-db-backups", "a.tar.gz"), "backup-bytes");
  write(path.join(old, "preferences.json"), '{"theme":"dark"}');
  write(path.join(old, "models", "m", "x.bin"), "bin");
  write(path.join(old, "artifacts", "r.txt"), "artifact");
  write(path.join(old, "weaveforge.log"), "log");
  write(path.join(old, "overleaf-git", "k-p.git", "HEAD"), "ref: refs/heads/main\n");
  write(path.join(old, "secrets.json"), "sealed");
}

function opts(d: Dirs, extra: Partial<MigrateOptions> = {}): MigrateOptions {
  return { oldDir: d.old, newDir: d.new, now: NOW, ...extra };
}

/** A live process that is not this one; the caller kills it. */
function liveHolder(): ChildProcess {
  return spawn(process.execPath, ["-e", "setTimeout(()=>{},30000)"], { stdio: "ignore" });
}

/** A pid that belonged to a process which has now exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid as number;
  await once(child, "exit");
  return pid;
}

function writeLock(file: string, pid: number): void {
  write(file, JSON.stringify({ pid, app: "WeaveForge", at: NOW.toISOString() }));
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

test("already: a done marker in new/ means nothing is touched", () => {
  const d = dirs();
  seedOld(d.old);
  write(path.join(d.new, DONE_MARKER), "{}");
  const out = migrateFromElectron(opts(d));
  assert.deepEqual(out, { kind: "already" });
  assert.deepEqual(fs.readdirSync(d.new), [DONE_MARKER]);
  assert.equal(fs.existsSync(path.join(d.old, MIGRATED_MARKER)), false);
});

test("nothing: an empty old dir writes the done marker with no copies", () => {
  const d = dirs();
  const out = migrateFromElectron(opts(d));
  assert.deepEqual(out, { kind: "nothing" });
  const done = readJson(path.join(d.new, DONE_MARKER));
  assert.deepEqual(done.copied, []);
});

test("done: copies every item, keeps the old dir, writes markers", () => {
  const d = dirs();
  seedOld(d.old);
  const out = migrateFromElectron(opts(d));
  assert.deepEqual(out, { kind: "done", copied: [...ITEMS] });

  const files = [
    "local-db/PG_VERSION",
    "local-db-backups/a.tar.gz",
    "preferences.json",
    "models/m/x.bin",
    "artifacts/r.txt",
    "weaveforge.log",
    "overleaf-git/k-p.git/HEAD",
  ];
  for (const f of files) {
    assert.equal(
      fs.readFileSync(path.join(d.new, f), "utf8"),
      fs.readFileSync(path.join(d.old, f), "utf8"),
      f,
    );
    assert.equal(fs.existsSync(path.join(d.old, f)), true, `old kept ${f}`);
  }
  assert.equal(fs.existsSync(path.join(d.old, "secrets.json")), true);

  const marker = readJson(path.join(d.old, MIGRATED_MARKER));
  assert.equal(marker.to, d.new);
  assert.equal(marker.at, NOW.toISOString());

  const done = readJson(path.join(d.new, DONE_MARKER));
  assert.equal(done.secretsLeftBehind, true);
  assert.equal(fs.existsSync(path.join(d.new, "secrets.json")), false);
  assert.equal(fs.existsSync(path.join(d.new, ".migrating")), false);
  assert.equal(fs.existsSync(path.join(d.old, "local-db.lock")), false);
});

test("busy: a live lock on old local-db refuses and changes nothing", async () => {
  const d = dirs();
  write(path.join(d.old, "local-db", "PG_VERSION"), "17");
  const child = liveHolder();
  try {
    const lock = path.join(d.old, "local-db.lock");
    writeLock(lock, child.pid as number);
    const before = fs.readFileSync(lock, "utf8");

    const out = migrateFromElectron(opts(d));
    assert.ok(out.kind === "busy");
    assert.match(out.reason, /WeaveForge/);

    assert.equal(fs.existsSync(d.new), false);
    assert.equal(fs.existsSync(path.join(d.old, MIGRATED_MARKER)), false);
    assert.equal(fs.readFileSync(lock, "utf8"), before);
  } finally {
    child.kill();
  }
});

test("busy from the workspace database; the local-db lock is released", () => {
  const d = dirs();
  write(path.join(d.old, "local-db", "PG_VERSION"), "17");
  write(path.join(d.old, "preferences.json"), JSON.stringify({ "vault-root": path.join(d.root, "ws") }));
  const wsDb = path.join(d.root, "ws", ".weaveforge", "db");
  fs.mkdirSync(wsDb, { recursive: true });
  const child = liveHolder();
  try {
    writeLock(path.join(d.root, "ws", ".weaveforge", "db.lock"), child.pid as number);

    const out = migrateFromElectron(opts(d));
    assert.ok(out.kind === "busy");
    assert.equal(fs.existsSync(path.join(d.old, "local-db.lock")), false);
  } finally {
    child.kill();
  }
});

test("a stale lock (dead pid) is taken over and then removed", async () => {
  const d = dirs();
  write(path.join(d.old, "local-db", "PG_VERSION"), "17");
  writeLock(path.join(d.old, "local-db.lock"), await deadPid());

  const out = migrateFromElectron(opts(d));
  assert.deepEqual(out, { kind: "done", copied: ["local-db"] });
  assert.equal(fs.existsSync(path.join(d.old, "local-db.lock")), false);
});

test("a failed copy throws, publishes nothing, and a retry completes", () => {
  const d = dirs();
  seedOld(d.old);
  let calls = 0;
  assert.throws(
    () =>
      migrateFromElectron(
        opts(d, {
          copy: (from, to) => {
            calls++;
            if (calls === 2) throw new Error("disk full");
            fs.cpSync(from, to, { recursive: true });
          },
        }),
      ),
    /disk full/,
  );
  for (const item of ITEMS) {
    assert.equal(fs.existsSync(path.join(d.new, item)), false, item);
  }
  assert.equal(fs.existsSync(path.join(d.new, DONE_MARKER)), false);
  assert.equal(fs.existsSync(path.join(d.old, MIGRATED_MARKER)), false);
  assert.equal(fs.existsSync(path.join(d.old, "local-db.lock")), false);

  const out = migrateFromElectron(opts(d));
  assert.deepEqual(out, { kind: "done", copied: [...ITEMS] });
});

test("resume: an item already in new/ is replaced by the old copy and the new one kept aside", () => {
  const d = dirs();
  write(path.join(d.old, "local-db", "x"), "fresh");
  write(path.join(d.new, "local-db", "x"), "stale");

  const out = migrateFromElectron(opts(d));
  assert.deepEqual(out, { kind: "done", copied: ["local-db"] });
  assert.equal(fs.readFileSync(path.join(d.new, "local-db", "x"), "utf8"), "fresh");
  const stamp = NOW.toISOString().replace(/[:.]/g, "-");
  const aside = path.join(d.new, ".pre-migration", stamp, "local-db", "x");
  assert.equal(fs.readFileSync(aside, "utf8"), "stale");
});

test("guard: new dir equal to, or inside, the old dir is refused", () => {
  const d = dirs();
  seedOld(d.old);
  assert.throws(() => migrateFromElectron(opts(d, { newDir: d.old })), /must not be the old app's data dir/);
  assert.throws(
    () => migrateFromElectron(opts(d, { newDir: path.join(d.old, "sub") })),
    /must not be the old app's data dir/,
  );
  assert.throws(
    () => migrateFromElectron(opts(d, { newDir: path.join(d.old, "..x") })),
    /must not be the old app's data dir/,
  );
  assert.equal(fs.existsSync(path.join(d.old, "sub")), false);
});

test("guard: a sibling of the old dir is allowed", () => {
  const d = dirs();
  const out = migrateFromElectron(opts(d, { newDir: `${d.old}-2` }));
  assert.deepEqual(out, { kind: "nothing" });
});

test("publish rename fails: nothing is marked done, and a rerun converges", () => {
  const d = dirs();
  seedOld(d.old);
  write(path.join(d.old, "local-db", "x"), "fresh");
  const preferences = path.join(d.new, "preferences.json");
  assert.throws(
    () =>
      migrateFromElectron(
        opts(d, {
          rename: (from, to) => {
            if (to === preferences) throw new Error("rename failed");
            fs.renameSync(from, to);
          },
        }),
      ),
    /rename failed/,
  );
  assert.equal(fs.existsSync(path.join(d.old, MIGRATED_MARKER)), true);
  assert.equal(fs.existsSync(path.join(d.new, DONE_MARKER)), false);
  assert.equal(fs.existsSync(path.join(d.old, "local-db.lock")), false);
  assert.equal(fs.readFileSync(path.join(d.new, "local-db", "x"), "utf8"), "fresh");

  const later = new Date("2026-10-30T09:00:00.000Z");
  const out = migrateFromElectron(opts(d, { now: later }));
  assert.deepEqual(out, { kind: "done", copied: [...ITEMS] });
  assert.equal(
    fs.readFileSync(preferences, "utf8"),
    fs.readFileSync(path.join(d.old, "preferences.json"), "utf8"),
  );
  assert.equal(fs.readFileSync(path.join(d.new, "local-db", "x"), "utf8"), "fresh");
  const stamp = later.toISOString().replace(/[:.]/g, "-");
  const aside = path.join(d.new, ".pre-migration", stamp, "local-db");
  assert.equal(fs.existsSync(path.join(aside, "PG_VERSION")), true);
  assert.equal(fs.readFileSync(path.join(aside, "x"), "utf8"), "fresh");
  assert.equal(fs.existsSync(path.join(d.new, ".migrating")), false);
});

test("aside rename fails: the existing item survives, and a rerun converges", () => {
  const d = dirs();
  seedOld(d.old);
  write(path.join(d.old, "local-db", "x"), "fresh");
  write(path.join(d.new, "local-db", "x"), "stale");
  const asideRoot = path.join(d.new, ".pre-migration") + path.sep;
  assert.throws(
    () =>
      migrateFromElectron(
        opts(d, {
          rename: (from, to) => {
            if (to.startsWith(asideRoot)) throw new Error("aside failed");
            fs.renameSync(from, to);
          },
        }),
      ),
    /aside failed/,
  );
  assert.equal(fs.readFileSync(path.join(d.new, "local-db", "x"), "utf8"), "stale");
  assert.equal(fs.existsSync(path.join(d.new, DONE_MARKER)), false);
  assert.equal(fs.existsSync(path.join(d.old, "local-db.lock")), false);

  const later = new Date("2026-10-30T09:00:00.000Z");
  const out = migrateFromElectron(opts(d, { now: later }));
  assert.deepEqual(out, { kind: "done", copied: [...ITEMS] });
  assert.equal(fs.readFileSync(path.join(d.new, "local-db", "x"), "utf8"), "fresh");
  const stamp = later.toISOString().replace(/[:.]/g, "-");
  const kept = path.join(d.new, ".pre-migration", stamp, "local-db", "x");
  assert.equal(fs.readFileSync(kept, "utf8"), "stale");
});
