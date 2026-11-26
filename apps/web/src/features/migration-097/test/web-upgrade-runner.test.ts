import assert from "node:assert/strict";
import { test } from "node:test";
import { OUTBOX_NOT_EMPTY_REASON, type ExportProgress, type ExportResult } from "../application/run-web-export";
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
  undecryptable: 0,
  archivedOnly: [],
};

function deps(run: WebUpgradeRun) {
  return {
    run,
    server: SERVER,
    pendingOutbox: async () => 0,
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

test("web upgrade runner: the reply carries archivedOnly to the screen", async () => {
  const rows = [{ kind: "tags", id: "t2", reason: "conflict" as const }];
  const runner = makeWebUpgradeRunner(deps(async () => ({ ...RESULT, archivedOnly: rows })));
  assert.deepEqual((await runner("")).archivedOnly, rows);
});

test("web upgrade runner: the local outbox count is passed through, never a stub 0", async () => {
  const calls: WebUpgradeOptions[] = [];
  const run: WebUpgradeRun = async (opts) => {
    calls.push(opts);
    return RESULT;
  };
  await makeWebUpgradeRunner({ ...deps(run), pendingOutbox: async () => 2 })("", () => {});

  assert.equal(calls.length, 1);
  assert.equal(await calls[0]!.server.pendingOutbox!(), 2, "the unflushed outbox rows reach the export's refusal check");
});

test("web upgrade runner: a refusal for unsent outbox ops is flagged pendingSync, other refusals are not", async () => {
  const refused = (reason: string): WebUpgradeRun => async () => ({
    ...RESULT,
    state: "incomplete",
    run: { missing: [{ kind: "*", id: "*", reason }] } as unknown as ExportResult["run"],
  });
  const flagged = await makeWebUpgradeRunner(deps(refused(OUTBOX_NOT_EMPTY_REASON)))("", () => {});
  assert.equal(flagged.pendingSync, true);
  const other = await makeWebUpgradeRunner(deps(refused("backup-failed")))("", () => {});
  assert.equal(other.pendingSync, false);
});

test("web upgrade runner: the run's undecryptable count reaches the screen unchanged", async () => {
  const run: WebUpgradeRun = async () => ({ ...RESULT, state: "incomplete", undecryptable: 4 });
  const reply = await makeWebUpgradeRunner(deps(run))("", () => {});

  assert.equal(reply.state, "incomplete");
  assert.equal(reply.undecryptable, 4);
});
