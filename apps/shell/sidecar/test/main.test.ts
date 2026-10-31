import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs, sidecarHandlers } from "../src/main";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const mainSrc = path.join(here, "../src/main.ts");
const migrations = [path.join(repoRoot, "db/migrations"), path.join(repoRoot, "db/migrations-local")];

test("parseArgs reads a full valid argv", () => {
  assert.deepEqual(
    parseArgs(["--data-dir", "d/db", "--migrations", "m1", "--migrations", "m2", "--backups", "b"]),
    { dataDir: path.resolve("d/db"), migrations: [path.resolve("m1"), path.resolve("m2")], backupsDir: path.resolve("b") },
  );
});

test("parseArgs names a missing --data-dir", () => {
  assert.equal(parseArgs(["--migrations", "m1", "--backups", "b"]), "missing --data-dir");
});

test("parseArgs names a missing --migrations", () => {
  assert.equal(parseArgs(["--data-dir", "d", "--backups", "b"]), "missing --migrations");
});

test("parseArgs names a missing --backups", () => {
  assert.equal(parseArgs(["--data-dir", "d", "--migrations", "m"]), "missing --backups");
});

test("parseArgs names a trailing flag with no value", () => {
  assert.equal(parseArgs(["--data-dir"]), "--data-dir needs a value");
});

test("parseArgs names an unknown argument", () => {
  assert.equal(
    parseArgs(["--data-dir", "d", "--migrations", "m", "--backups", "b", "--bogus"]),
    "unknown argument: --bogus",
  );
});

test("parseArgs reads an optional --migrate-from", () => {
  const parsed = parseArgs(["--data-dir", "d", "--migrations", "m", "--backups", "b", "--migrate-from", "o"]);
  assert.deepEqual(parsed, {
    dataDir: path.resolve("d"),
    migrations: [path.resolve("m")],
    backupsDir: path.resolve("b"),
    migrateFrom: path.resolve("o"),
  });
});

test("parseArgs names a trailing --migrate-from with no value", () => {
  assert.equal(parseArgs(["--data-dir", "d", "--migrations", "m", "--backups", "b", "--migrate-from"]), "--migrate-from needs a value");
});

test("parseArgs reads the app flags", () => {
  assert.deepEqual(
    parseArgs(["--data-dir", "d", "--migrations", "m", "--backups", "b", "--artifacts", "a", "--bridge", "br.mjs", "--app-version", "1.2.3", "--home-variant", "dev"]),
    {
      dataDir: path.resolve("d"),
      migrations: [path.resolve("m")],
      backupsDir: path.resolve("b"),
      artifacts: path.resolve("a"),
      bridge: path.resolve("br.mjs"),
      appVersion: "1.2.3",
      homeVariant: "dev",
    },
  );
});

test("parseArgs names a trailing --home-variant with no value", () => {
  assert.equal(parseArgs(["--data-dir", "d", "--migrations", "m", "--backups", "b", "--home-variant"]), "--home-variant needs a value");
});

test("parseArgs leaves the app fields out when their flags are absent", () => {
  const parsed = parseArgs(["--data-dir", "d", "--migrations", "m", "--backups", "b"]) as object;
  for (const key of ["artifacts", "bridge", "appVersion", "homeVariant"]) assert.equal(key in parsed, false);
});

test("query passes [] as params when none are given", async () => {
  const handlers = sidecarHandlers({
    host: {
      query: async (sql, params) => ({ ok: true, value: [{ sql, params }] }),
      state: () => ({ failure: null, dataDir: "d", restoredFrom: null }),
      reset: async () => ({ ok: true, value: null }),
    },
    restartWanted: () => false,
  });
  assert.deepEqual(await handlers.query!({ sql: "select 1" }), [{ sql: "select 1", params: [] }]);
});

test("query rejects bad params", async () => {
  const handlers = sidecarHandlers({
    host: {
      query: async () => ({ ok: true, value: [] }),
      state: () => ({ failure: null, dataDir: "d", restoredFrom: null }),
      reset: async () => ({ ok: true, value: null }),
    },
    restartWanted: () => false,
  });
  for (const bad of ["x", null, {}, { sql: 1 }, { sql: "select 1", params: "a" }, { sql: "select 1", params: { 0: 1 } }]) {
    await assert.rejects(() => handlers.query!(bad), { message: "query needs { sql, params? }" });
  }
});

test("query rejects with the host's message on failure", async () => {
  const handlers = sidecarHandlers({
    host: {
      query: async () => ({ ok: false, message: "nope" }),
      state: () => ({ failure: null, dataDir: "d", restoredFrom: null }),
      reset: async () => ({ ok: true, value: null }),
    },
    restartWanted: () => false,
  });
  await assert.rejects(() => handlers.query!({ sql: "select 1" }), { message: "nope" });
});

test("state carries the restart flag", async () => {
  let restart = false;
  const handlers = sidecarHandlers({
    host: {
      query: async () => ({ ok: true, value: [] }),
      state: () => ({ failure: null, dataDir: "d", restoredFrom: null }),
      reset: async () => ({ ok: true, value: null }),
    },
    restartWanted: () => restart,
  });
  assert.deepEqual(await handlers.state!(undefined), { failure: null, dataDir: "d", restoredFrom: null, restart: false });
  restart = true;
  assert.deepEqual(await handlers.state!(undefined), { failure: null, dataDir: "d", restoredFrom: null, restart: true });
});

test("query refuses while a restart is pending", async () => {
  let queried = false;
  const handlers = sidecarHandlers({
    host: {
      query: async () => {
        queried = true;
        return { ok: true, value: [] };
      },
      state: () => ({ failure: null, dataDir: "d", restoredFrom: null }),
      reset: async () => ({ ok: true, value: null }),
    },
    restartWanted: () => true,
  });
  await assert.rejects(() => handlers.query!({ sql: "select 1" }), { message: "local database: restarting" });
  assert.equal(queried, false);
});

test("reset returns the restart flag when the host resets", async () => {
  const handlers = sidecarHandlers({
    host: {
      query: async () => ({ ok: true, value: [] }),
      state: () => ({ failure: null, dataDir: "d", restoredFrom: null }),
      reset: async () => ({ ok: true, value: null }),
    },
    restartWanted: () => true,
  });
  assert.deepEqual(await handlers.reset!(undefined), { restart: true });
});

test("reset rejects with the host's message when the host refuses", async () => {
  const handlers = sidecarHandlers({
    host: {
      query: async () => ({ ok: true, value: [] }),
      state: () => ({ failure: null, dataDir: "d", restoredFrom: null }),
      reset: async () => ({ ok: false, message: "nope" }),
    },
    restartWanted: () => false,
  });
  await assert.rejects(() => handlers.reset!(undefined), { message: "nope" });
});

test("stats reports a numeric pid and rss", async () => {
  const handlers = sidecarHandlers({
    host: {
      query: async () => ({ ok: true, value: [] }),
      state: () => ({ failure: null, dataDir: "d", restoredFrom: null }),
      reset: async () => ({ ok: true, value: null }),
    },
    restartWanted: () => false,
  });
  const stats = (await handlers.stats!(undefined)) as { pid: number; rss: number };
  assert.equal(typeof stats.pid, "number");
  assert.equal(typeof stats.rss, "number");
});

test("sidecar exposes exactly query, reset, state and stats", () => {
  const handlers = sidecarHandlers({
    host: {
      query: async () => ({ ok: true, value: [] }),
      state: () => ({ failure: null, dataDir: "d", restoredFrom: null }),
      reset: async () => ({ ok: true, value: null }),
    },
    restartWanted: () => false,
  });
  assert.deepEqual(Object.keys(handlers).sort(), ["query", "reset", "state", "stats"]);
});

/** Spawn the sidecar on `dataDir` and return it with a reader over its stdout lines. */
function spawnSidecar(dataDir: string, backupsDir: string, extraArgs: string[] = []) {
  const child = spawn(
    process.execPath,
    [
      "--import", "tsx", mainSrc,
      "--data-dir", dataDir,
      "--migrations", migrations[0]!,
      "--migrations", migrations[1]!,
      "--backups", backupsDir,
      ...extraArgs,
    ],
    { cwd: repoRoot, stdio: ["pipe", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity })[Symbol.asyncIterator]();
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  return { child, lines, exited, stderr: () => stderr };
}

/** Read stdout until the reply to `id` arrives; rejects if stdout closes first. */
async function replyTo(
  lines: AsyncIterator<string>,
  id: number,
): Promise<Record<string, unknown>> {
  for (;;) {
    const next = await lines.next();
    if (next.done) throw new Error(`stdout closed before reply ${id}`);
    const reply = JSON.parse(next.value) as Record<string, unknown>;
    if (reply.id === id) return reply;
  }
}

test("sidecar answers query and stats, backs up after a write, then exits 0 and releases the lock", { timeout: 180_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-sidecar-"));
  const dataDir = path.join(tmp, "db");
  const backupsDir = path.join(tmp, "backups");
  const lock = dataDir + ".lock";
  const { child, lines, exited, stderr } = spawnSidecar(dataDir, backupsDir);
  try {
    child.stdin!.write('{"id":1,"method":"query","params":{"sql":"select 1 as n"}}\n');
    const first = await replyTo(lines, 1);
    assert.deepEqual(first, { id: 1, ok: true, value: [{ n: 1 }] }, stderr());
    assert.ok(fs.existsSync(lock), "lock file should exist while the sidecar runs");

    child.stdin!.write('{"id":3,"method":"query","params":{"sql":"select count(*) as n from (values (1),(2)) v"}}\n');
    const count = await replyTo(lines, 3);
    // int8 arrives as a number under the desktop parsers, as it does in Electron.
    assert.deepEqual(count.value, [{ n: 2 }], stderr());

    child.stdin!.write('{"id":4,"method":"query","params":{"sql":"select \'\\\\x01ff\'::bytea as b"}}\n');
    const bytes = await replyTo(lines, 4);
    assert.deepEqual(bytes.value, [{ b: { $bytes: "Af8=" } }], stderr());

    child.stdin!.write('{"id":5,"method":"query","params":{"sql":"select $1::bytea as b","params":[{"$bytes":"AQI="}]}}\n');
    const param = await replyTo(lines, 5);
    assert.deepEqual(param.value, [{ b: { $bytes: "AQI=" } }], stderr());

    child.stdin!.write('{"id":2,"method":"stats"}\n');
    const second = await replyTo(lines, 2);
    assert.equal(second.ok, true, stderr());
    assert.ok((second.value as { rss: number }).rss > 0, stderr());

    // `public` is not writable by the app role; a temp table is still a write.
    child.stdin!.write('{"id":6,"method":"query","params":{"sql":"create temp table t(x int)"}}\n');
    const write = await replyTo(lines, 6);
    assert.equal(write.ok, true, stderr());

    child.stdin!.end();
    const code = await exited;
    assert.equal(code, 0, stderr());
    assert.equal(fs.existsSync(lock), false, stderr());
    // The shutdown backup runs after the write, so one backup file exists.
    assert.equal(fs.readdirSync(backupsDir).length, 1, stderr());
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("sidecar exits 3 when the database lock is held by a live process", { timeout: 180_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-sidecar-"));
  const dataDir = path.join(tmp, "db");
  fs.writeFileSync(
    dataDir + ".lock",
    JSON.stringify({ pid: process.pid, app: "test", at: new Date().toISOString() }),
  );
  const { child, exited, stderr } = spawnSidecar(dataDir, path.join(tmp, "backups"));
  try {
    const code = await exited;
    assert.equal(code, 3);
    assert.notEqual(stderr(), "");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("sidecar exits 3 when the old app's database is held by a live process", { timeout: 180_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-sidecar-"));
  const oldDir = path.join(tmp, "old");
  fs.mkdirSync(path.join(oldDir, "local-db", "PG_VERSION"), { recursive: true });
  fs.writeFileSync(path.join(oldDir, "preferences.json"), '{"theme":"dark"}');
  const holder = spawn(process.execPath, ["-e", "setTimeout(()=>{},30000)"], { stdio: "ignore" });
  fs.writeFileSync(
    path.join(oldDir, "local-db.lock"),
    JSON.stringify({ pid: holder.pid, app: "WeaveForge", at: new Date().toISOString() }),
  );
  const { child, exited, stderr } = spawnSidecar(path.join(tmp, "new", "local-db"), path.join(tmp, "backups"), ["--migrate-from", oldDir]);
  try {
    const code = await exited;
    assert.equal(code, 3, stderr());
    assert.ok(stderr().includes("old WeaveForge app is running"), stderr());
    assert.equal(fs.existsSync(path.join(tmp, "new", "migrated-from-electron")), false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    holder.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
