import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWebUpgradeRunner } from "../application/web-upgrade-runner";
import { webUpgradeFor, webPendingOutbox, type WebUpgradeInputs } from "../application/web-upgrade-options";
import { runWebExport, type ExportResult } from "../application/run-web-export";
import { MemorySink } from "../infrastructure/memory-sink";
import { NOW, fakeCodec, fakeServer, FIXTURE, KINDS, SUPPORTED } from "./web-export/helpers";
import type { FileCodec, FileSink } from "../domain/ports";

const sink: FileSink = {
  write: async () => {},
  list: async () => [],
  readText: async () => "",
  readBytes: async () => new Uint8Array(),
  exists: async () => false,
  rename: async () => {},
  remove: async () => {},
  writeIf: async () => true,
};
const codec: FileCodec = {
  supports: () => false,
  toFile: () => ({ path: "", text: "" }),
  toRow: () => null,
} as unknown as FileCodec;

function inputs(overrides: Partial<WebUpgradeInputs> = {}): WebUpgradeInputs {
  return {
    baseUrl: "https://api.example.test/rest/v1",
    userId: "u1",
    anonKey: "anon",
    accessToken: async () => "tok",
    fetch: globalThis.fetch,
    sink,
    codec,
    kinds: ["notes", "papers"],
    pendingOutbox: async () => 0,
    now: "2026-11-22T00:00:00.000Z",
    runDeviceId: "dev-1",
    ...overrides,
  };
}

const verified: ExportResult = {
  state: "verified",
  run: { missing: [] },
} as unknown as ExportResult;

test("desktop gets no web runner: the options are null", () => {
  assert.equal(webUpgradeFor(true, inputs()), null);
});

test("web with a signed-in user gets options that build a non-null runExport", () => {
  const opts = webUpgradeFor(false, inputs());
  assert.notEqual(opts, null);
  assert.equal(typeof makeWebUpgradeRunner(opts!), "function");
});

test("web export with no desktop outbox reaches verified: the web count is 0", async () => {
  assert.equal(await webPendingOutbox(), 0, "the web keeps no local sync outbox");
  const { source } = fakeServer({ rows: FIXTURE });
  const result = await runWebExport({
    runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source: { ...source, pendingOutbox: webPendingOutbox },
    sink: new MemorySink(),
    now: NOW,
  });
  assert.equal(result.state, "verified");
});

test("web without a session gets no runner", () => {
  assert.equal(webUpgradeFor(false, null), null);
});

test("a verified run calls onVerified once; a stopped run does not", async () => {
  const seen: string[] = [];
  const opts = webUpgradeFor(
    false,
    inputs({
      onVerified: () => seen.push("verified"),
      run: async () => {
        seen.push("ran");
        return verified;
      },
    }),
  )!;
  await opts.run(opts, undefined);
  assert.deepEqual(seen, ["ran", "verified"]);

  const stopped = webUpgradeFor(
    false,
    inputs({
      onVerified: () => seen.push("verified"),
      run: async () => {
        seen.push("stopped-run");
        return { state: "incomplete", run: { missing: [] } } as unknown as ExportResult;
      },
    }),
  )!;
  await stopped.run(stopped, undefined);
  assert.deepEqual(seen, ["ran", "verified", "stopped-run"], "a stopped run must not set the marker");
});
