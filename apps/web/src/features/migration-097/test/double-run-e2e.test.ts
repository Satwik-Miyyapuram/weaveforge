import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { MIGRATION_KINDS, REPORT_PATH, runIsClean } from "../domain/report";
import type { BlobRef, FileCodec, Row, ServerSource } from "../domain/ports";
import { runWebExport } from "../application/run-web-export";
import { MemorySink } from "../infrastructure/memory-sink";

before(loadTestCore);

const NOW = "2026-11-22T00:00:00.000Z";
const DEVICE = { runDeviceId: "dev-e2e" };

// Rows for the kinds that have a codec (logEntries, experiments), a writer (paperFields, via projectFolders)
// and a blob. Every other MIGRATION kind has no rows, so it is counted and clean.
const LOG: Row[] = [
  { id: "l1", text: "first" },
  { id: "l2", text: "second  " },
];
const EXPERIMENTS: Row[] = [{ id: "e1", name: "Exp", n: 3, tags: ["x"] }];
const DEFS: Row[] = [
  { id: "fa", projectId: "proj-a", name: "Venue", kind: "text", options: [], sortOrder: 0 },
  { id: "fb", projectId: "proj-b", name: "Venue", kind: "select", options: ["ICML"], sortOrder: 0 },
];
const FOLDERS = new Map([
  ["proj-a", "Thesis"],
  ["proj-b", ""],
]);
const CODEC_KINDS = ["logEntries", "experiments"];
const BLOB: { ref: BlobRef; bytes: Uint8Array } = {
  ref: { bucket: "images", path: "a.webp", sizeBytes: 4 },
  bytes: new Uint8Array([1, 2, 3, 4]),
};

const codec: FileCodec = {
  supports: (kind) => CODEC_KINDS.includes(kind),
  toFile: (kind, row) => ({ path: `${kind}/${String(row.id)}.json`, text: JSON.stringify(row) }),
  toRow: (kind, path, text) => (path.startsWith(`${kind}/`) ? (JSON.parse(text) as Row) : null),
};

function server(): ServerSource {
  const rows: Record<string, Row[]> = { logEntries: LOG, experiments: EXPERIMENTS, paperFields: DEFS };
  return {
    listRows: async (kind: string) => rows[kind] ?? [],
    countRows: async (kind: string) => (rows[kind] ?? []).length,
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async () => [BLOB.ref],
    fetchBlob: async () => BLOB.bytes,
    markExported097: async () => {},
    secretCount: async () => 0,
  } as unknown as ServerSource;
}

function exportRun(sink: MemorySink) {
  return runWebExport({
    ...DEVICE,
    kinds: MIGRATION_KINDS,
    codec,
    source: server(),
    sink,
    now: NOW,
    projectFolders: FOLDERS,
  });
}

/** Every data file (the report is excluded: its timestamps change each run), as base64 bytes. */
async function dataFiles(sink: MemorySink): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const path of await sink.list()) {
    if (path === REPORT_PATH) continue;
    out.set(path, Buffer.from(await sink.readBytes(path)).toString("base64"));
  }
  return out;
}

test("double run on unchanged data: run 2 is verified and clean, writes no new file and keeps every byte", async () => {
  const sink = new MemorySink();
  const first = await exportRun(sink);
  assert.equal(first.state, "verified", JSON.stringify(first.run.missing));
  const afterFirst = await dataFiles(sink);

  const second = await exportRun(sink);
  assert.equal(second.state, "verified", JSON.stringify(second.run.missing));
  assert.deepEqual(second.run.conflicts ?? [], []);
  assert.deepEqual(await dataFiles(sink), afterFirst);
  assert.equal(runIsClean(second.run), true);
});

test("double run with one note edited by the user between runs: one conflict copy, the user's bytes kept, run not clean", async () => {
  const sink = new MemorySink();
  assert.equal((await exportRun(sink)).state, "verified");

  const userText = JSON.stringify({ id: "l1", text: "edited by user" });
  await sink.write("logEntries/l1.json", userText);

  const second = await exportRun(sink);
  assert.deepEqual(second.run.conflicts, ["logEntries/l1 (conflict).json"]);
  assert.equal(await sink.readText("logEntries/l1.json"), userText, "the user's file is kept");
  const copy = JSON.parse(await sink.readText("logEntries/l1 (conflict).json")) as Row;
  assert.equal(copy.text, "first", "the conflict copy holds the DB version");
  assert.equal(runIsClean(second.run), false);
});
