import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExportProgress, ExportResult } from "../application/run-web-export";
import { makeWebUpgradeRunner, type WebUpgradeRun } from "../application/web-upgrade-runner";
import type { WebUpgradeOptions } from "../application/run-web-upgrade";
import type { FileCodec } from "../domain/ports";
import { MemorySink } from "../infrastructure/memory-sink";

const NOW = "2026-11-22T00:00:00.000Z";
const CODEC: FileCodec = {
  supports: () => false,
  toFile: () => ({ path: "", text: "" }),
  toRow: () => null,
};
const SERVER = {
  baseUrl: "https://api.example.test",
  userId: "u1",
  headers: {},
  fetch: globalThis.fetch,
};
const RESULT: ExportResult = {
  state: "verified",
  run: {} as ExportResult["run"],
  reconnectProviders: ["zotero"],
};

function deps(run: WebUpgradeRun) {
  return {
    run,
    server: SERVER,
    kinds: ["logEntries"],
    codec: CODEC,
    sink: new MemorySink(),
    now: NOW,
    runDeviceId: "web-me",
  };
}

test("web upgrade runner: one start calls the upgrade once, forwards progress, returns reconnect names", async () => {
  const calls: WebUpgradeOptions[] = [];
  const seen: string[] = [];
  const run: WebUpgradeRun = async (opts, onProgress) => {
    calls.push(opts);
    onProgress?.({ kind: "logEntries", done: 1, total: 1 });
    return RESULT;
  };
  const runner = makeWebUpgradeRunner(deps(run));

  const reply = await runner("", (p: ExportProgress) => seen.push(`${p.kind}:${p.done}/${p.total}`));

  assert.equal(calls.length, 1, "Start calls the upgrade exactly once");
  assert.equal(reply.state, "verified");
  assert.deepEqual(reply.reconnectProviders, ["zotero"], "provider names only");
  assert.deepEqual(seen, ["logEntries:1/1"]);
});

test("web upgrade runner: no local outbox and no decrypt probe on the web, so both counts are 0", async () => {
  let captured: WebUpgradeOptions | undefined;
  const run: WebUpgradeRun = async (opts) => {
    captured = opts;
    return RESULT;
  };
  await makeWebUpgradeRunner(deps(run))("", () => {});

  assert.ok(captured, "the upgrade ran");
  assert.equal(await captured.server.pendingOutbox?.(), 0);
  assert.equal(await captured.server.undecryptable?.("logEntries"), 0);
});
