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
    parseArgs(["--data-dir", "d/db", "--migrations", "m1", "--migrations", "m2"]),
    { dataDir: path.resolve("d/db"), migrations: [path.resolve("m1"), path.resolve("m2")] },
  );
});

test("parseArgs names a missing --data-dir", () => {
  assert.equal(parseArgs(["--migrations", "m1"]), "missing --data-dir");
});

test("parseArgs names a missing --migrations", () => {
  assert.equal(parseArgs(["--data-dir", "d"]), "missing --migrations");
});

test("parseArgs names a trailing flag with no value", () => {
  assert.equal(parseArgs(["--data-dir"]), "--data-dir needs a value");
});

test("parseArgs names an unknown argument", () => {
  assert.equal(
    parseArgs(["--data-dir", "d", "--migrations", "m", "--bogus"]),
    "unknown argument: --bogus",
  );
});

test("query passes [] as params when none are given", async () => {
  const handlers = sidecarHandlers({
    query: async (sql, params) => ({ ok: true, value: [{ sql, params }] }),
    state: () => ({ failure: null, dataDir: "d", restoredFrom: null }),
  });
  assert.deepEqual(await handlers.query!({ sql: "select 1" }), [{ sql: "select 1", params: [] }]);
});

test("query rejects bad params", async () => {
  const handlers = sidecarHandlers({
    query: async () => ({ ok: true, value: [] }),
    state: () => ({ failure: null, dataDir: "d", restoredFrom: null }),
  });
  for (const bad of ["x", null, {}, { sql: 1 }, { sql: "select 1", params: "a" }, { sql: "select 1", params: { 0: 1 } }]) {
    await assert.rejects(() => handlers.query!(bad), { message: "query needs { sql, params? }" });
  }
});

test("query rejects with the host's message on failure", async () => {
  const handlers = sidecarHandlers({
    query: async () => ({ ok: false, message: "nope" }),
    state: () => ({ failure: null, dataDir: "d", restoredFrom: null }),
  });
  await assert.rejects(() => handlers.query!({ sql: "select 1" }), { message: "nope" });
});

test("stats reports a numeric pid and rss", async () => {
  const handlers = sidecarHandlers({
    query: async () => ({ ok: true, value: [] }),
    state: () => ({ failure: null, dataDir: "d", restoredFrom: null }),
  });
  const stats = (await handlers.stats!(undefined)) as { pid: number; rss: number };
  assert.equal(typeof stats.pid, "number");
  assert.equal(typeof stats.rss, "number");
});

test("sidecar exposes exactly query, state and stats", () => {
  const handlers = sidecarHandlers({
    query: async () => ({ ok: true, value: [] }),
    state: () => ({ failure: null, dataDir: "d", restoredFrom: null }),
  });
  assert.deepEqual(Object.keys(handlers), ["query", "state", "stats"]);
});

/** Spawn the sidecar on `dataDir` and return it with a reader over its stdout lines. */
function spawnSidecar(dataDir: string) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", mainSrc, "--data-dir", dataDir, "--migrations", migrations[0]!, "--migrations", migrations[1]!],
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

test("sidecar answers query and stats, then exits 0 and releases the lock", { timeout: 180_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-sidecar-"));
  const dataDir = path.join(tmp, "db");
  const lock = dataDir + ".lock";
  const { child, lines, exited, stderr } = spawnSidecar(dataDir);
  try {
    child.stdin!.write('{"id":1,"method":"query","params":{"sql":"select 1 as n"}}\n');
    const first = await replyTo(lines, 1);
    assert.deepEqual(first, { id: 1, ok: true, value: [{ n: 1 }] }, stderr());
    assert.ok(fs.existsSync(lock), "lock file should exist while the sidecar runs");

    child.stdin!.write('{"id":2,"method":"stats"}\n');
    const second = await replyTo(lines, 2);
    assert.equal(second.ok, true, stderr());
    assert.ok((second.value as { rss: number }).rss > 0, stderr());

    child.stdin!.end();
    const code = await exited;
    assert.equal(code, 0, stderr());
    assert.equal(fs.existsSync(lock), false, stderr());
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
  const { child, exited, stderr } = spawnSidecar(dataDir);
  try {
    const code = await exited;
    assert.equal(code, 3);
    assert.notEqual(stderr(), "");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
