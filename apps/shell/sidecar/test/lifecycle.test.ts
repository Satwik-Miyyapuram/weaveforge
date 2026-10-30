import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  LocalClient,
  LocalTransaction,
} from "../../../desktop/src/local-db";
import { backupFileName } from "../../../desktop/src/local-db-backup";
import type { MoveOutcome } from "../../../desktop/src/local-db-reset";
import { createLifecycle, type Lifecycle } from "../src/lifecycle";

const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const RETRY = { attempts: 1, backoffMs: 0, maxBackoffMs: 0 };

interface Fixture {
  dataDir: string;
  backupsDir: string;
  migrations: string[];
}

/** A fresh temp tree: `<tmp>/local-db`, its backups, and an empty migrations dir. */
function fixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wf-lifecycle-"));
  roots.push(root);
  const migrationsDir = path.join(root, "migrations");
  fs.mkdirSync(migrationsDir);
  return {
    dataDir: path.join(root, "local-db"),
    backupsDir: path.join(root, "backups"),
    migrations: [migrationsDir],
  };
}

/** An engine that answers every statement with no rows; `dumpTo` writes a small file. */
function fakeEngine(dumpFails: boolean): LocalClient {
  const engine = {
    exec: async () => undefined,
    query: async () => ({ rows: [] }),
    transaction: async (fn: (tx: LocalTransaction) => Promise<unknown>) =>
      fn({ query: async () => ({ rows: [] }) }),
    close: async () => undefined,
    dumpTo: async (file: string) => {
      if (dumpFails) throw new Error("dump failed");
      fs.writeFileSync(file, "dump");
    },
  };
  return engine as unknown as LocalClient;
}

interface Behaviour {
  failOpen?: boolean;
  dumpFails?: boolean;
  move?: MoveOutcome;
}

function lifecycle(fx: Fixture, behaviour: Behaviour = {}): Lifecycle {
  return createLifecycle({
    dataDir: fx.dataDir,
    migrations: fx.migrations,
    backupsDir: fx.backupsDir,
    openEngine: async () => {
      if (behaviour.failOpen) throw new Error("open failed");
      fs.mkdirSync(fx.dataDir, { recursive: true });
      return fakeEngine(behaviour.dumpFails ?? false);
    },
    moveAside: behaviour.move
      ? async () => behaviour.move as MoveOutcome
      : undefined,
    log: () => undefined,
    retry: RETRY,
  });
}

test("reset on a healthy database is refused and sets no restart", async () => {
  const fx = fixture();
  const lc = lifecycle(fx);
  const q = await lc.host.query("select 1", []);
  assert.equal(q.ok, true);
  const r = await lc.host.reset();
  assert.equal(r.ok, false);
  assert.equal(lc.restartWanted(), false);
});

test("reset after a failed open moves the data directory aside", async () => {
  const fx = fixture();
  fs.mkdirSync(fx.dataDir, { recursive: true });
  const lc = lifecycle(fx, { failOpen: true });
  const q = await lc.host.query("select 1", []);
  assert.equal(q.ok, false);
  assert.notEqual(lc.host.state().failure, null);
  const r = await lc.host.reset();
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(fx.dataDir), false);
  const broken = fs
    .readdirSync(path.dirname(fx.dataDir))
    .filter((n) => n.startsWith("local-db.broken-"));
  assert.equal(broken.length, 1);
  assert.equal(lc.restartWanted(), false);
});

test("reset with a deferred move succeeds and asks for a restart", async () => {
  const fx = fixture();
  fs.mkdirSync(fx.dataDir, { recursive: true });
  const lc = lifecycle(fx, { failOpen: true, move: "deferred" });
  await lc.host.query("select 1", []);
  const r = await lc.host.reset();
  assert.equal(r.ok, true);
  assert.equal(lc.restartWanted(), true);
});

test("a failed open with a backup and a deferred move asks for a restart once", async () => {
  const fx = fixture();
  fs.mkdirSync(fx.dataDir, { recursive: true });
  fs.mkdirSync(fx.backupsDir, { recursive: true });
  fs.writeFileSync(
    path.join(fx.backupsDir, backupFileName(new Date())),
    "backup",
  );

  const first = lifecycle(fx, { failOpen: true, move: "deferred" });
  const q1 = await first.host.query("select 1", []);
  assert.equal(q1.ok, false);
  assert.equal(first.restartWanted(), true);
  assert.equal(fs.existsSync(`${fx.dataDir}.relaunched`), true);

  // The relaunch marker from the first attempt is still there: no second restart.
  const second = lifecycle(fx, { failOpen: true, move: "deferred" });
  const q2 = await second.host.query("select 1", []);
  assert.equal(q2.ok, false);
  assert.equal(second.restartWanted(), false);
});

test("backUp writes nothing until a write has happened, then one file", async () => {
  const fx = fixture();
  const lc = lifecycle(fx);
  await lc.backUp();
  const before = fs.existsSync(fx.backupsDir)
    ? fs.readdirSync(fx.backupsDir)
    : [];
  assert.deepEqual(before, []);

  const w = await lc.host.query("insert into t (x) values ($1)", [1]);
  assert.equal(w.ok, true);
  await lc.backUp();
  const files = fs
    .readdirSync(fx.backupsDir)
    .filter((n) => !n.endsWith(".part"));
  assert.equal(files.length, 1);
});

test("backUp never throws when the dump fails", async () => {
  const fx = fixture();
  const lc = lifecycle(fx, { dumpFails: true });
  await lc.host.query("insert into t (x) values ($1)", [1]);
  await assert.doesNotReject(lc.backUp());
  const files = fs.existsSync(fx.backupsDir)
    ? fs.readdirSync(fx.backupsDir)
    : [];
  assert.deepEqual(files, []);
});
