import assert from "node:assert/strict";
import { test } from "node:test";
import { runWebExport } from "../application/run-web-export";
import type { FileCodec, Row, ServerSource } from "../domain/ports";
import { REPORT_PATH } from "../domain/report";
import { MemorySink } from "../infrastructure/memory-sink";

const NOW = "2026-11-22T00:00:00.000Z";
const KINDS = ["logEntries"];

const codec: FileCodec = {
  supports: (kind) => kind === "logEntries",
  toFile: (kind, row) => ({ path: `${kind}/${String(row.id)}.json`, text: JSON.stringify(row) }),
  toRow: (kind, path, text) => (path.startsWith(`${kind}/`) ? (JSON.parse(text) as Row) : null),
};

/** A server whose provider list cannot be read, so the run refuses with "keys: unreadable". */
function serverWithUnreadableKeys(): ServerSource {
  return {
    listRows: async () => [{ id: "l1", text: "row" }],
    secretProviders: async () => {
      throw new Error("keys table unavailable");
    },
    countRows: async () => 1,
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async () => [],
    fetchBlob: async () => new Uint8Array(),
    markExported097: async () => {},
  } as unknown as ServerSource;
}

test("keys unreadable: the refused run is still written to report.json under this device's id", async () => {
  const sink = new MemorySink();
  const result = await runWebExport({
    kinds: KINDS,
    codec,
    source: serverWithUnreadableKeys(),
    sink,
    now: NOW,
    runDeviceId: "dev-keys-1",
    secretsPresent: true,
  });

  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason === "keys: unreadable"));
  const written = JSON.parse(await sink.readText(REPORT_PATH));
  assert.equal(written.state, "incomplete");
  assert.deepEqual(
    written.runs.map((r: { deviceId?: string; missing: { reason: string }[] }) => [r.deviceId, r.missing[0]?.reason]),
    [["dev-keys-1", "keys: unreadable"]],
    "the refusal reason reaches the report, tagged with the device that refused",
  );
});
