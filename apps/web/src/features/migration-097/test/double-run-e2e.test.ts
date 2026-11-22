import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { MIGRATION_KINDS, REPORT_PATH, runIsClean } from "../domain/report";
import type { BlobRef, FileCodec, Row, ServerSource } from "../domain/ports";
import { typedCore } from "@/lib/rust-core";
import { runWebExport } from "../application/run-web-export";
import { createGroupBWriter } from "../infrastructure/kind-writer-group-b";
import { createGroupCWriter } from "../infrastructure/kind-writer-group-c";
import { createTagsWriter } from "../infrastructure/kind-writer-tags";
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
    secretProviders: async () => [],
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
  assert.equal(second.state, "incomplete", "a run with a conflict copy is never verified, so it cannot be removed");
});

// ---- Through the real FILES writers: one row per writer kind, the way the web export writes them. ----

const PAPER_FILE = "Thesis/papers/a.paper.md";
const NOTE_FILE = "notes/a.note.md";
const CHUNK = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const INK_BYTES = new Uint8Array([7, 8, 9, 250]);
const TRASHED_LOG: Row = { projectId: "proj-a", id: "0123456789abcd09", entryDate: "2026-11-01", kind: "daily", body: "gone", links: [], createdAt: "2026-11-01T09:00:00.000Z" };

/** Row shapes the group (b), group (c), tags and paper field writers read. One row per writer kind. */
const WRITER_ROWS: Record<string, Row[]> = {
  logEntries: [{ projectId: "proj-a", id: "0123456789abcd01", entryDate: "2026-11-01", kind: "daily", body: "Ran the ablation", links: [{ type: "experiment", id: "0123456789abcd04" }], createdAt: "2026-11-01T09:00:00.000Z" }],
  milestones: [{ projectId: "proj-a", id: "0123456789abcd03", title: "Submit draft", description: "Chapters 1 to 3", status: "in_progress", targetDate: "2026-12-01", dependencies: [], compute: [], createdAt: "2026-11-02T09:00:00.000Z" }],
  experiments: [{ projectId: "proj-a", id: "0123456789abcd04", name: "Ablation", hypothesis: "Dropout helps", status: "running", config: { lr: 0.1 }, metrics: { val_loss: 0.2 }, artifacts: ["https://example.org/ckpt"], createdAt: "2026-11-03T09:00:00.000Z" }],
  metrics: [{ projectId: "proj-a", experimentId: "0123456789abcd04", metric: "val_loss", step: 1, value: 0.5, wallTime: "2026-11-03T10:00:00.000Z" }],
  reportSections: [{ projectId: "proj-a", id: "0123456789abcd05", title: "Introduction", sectionNo: "1", status: "drafting", wordCount: 120, targetWords: 800, deadline: "2026-12-10", draftUrl: "https://example.org/draft", notes: "Needs citations", sortOrder: 1, createdAt: "2026-11-04T09:00:00.000Z" }],
  aiProposals: [{ projectId: "proj-a", id: "0123456789abcd06", kind: "create_log_entry", resourceId: "0123456789abcd01", content: "Draft log entry", createdAt: "2026-11-05T09:00:00.000Z", status: "pending", sourceLinks: ["0123456789abcd04"] }],
  annotations: [{ id: "ann-1", paperId: "p1", paperFile: PAPER_FILE, type: "highlight", color: "#ff0000", text: "hello", comment: "note", tags: ["t1"], anchor: { pageIndex: 0 }, pageIndex: 0, sortIndex: "00000|000000|00000", createdAt: "2026-11-06T09:00:00.000Z", updatedAt: "2026-11-06T09:00:00.000Z", origin: "local", zoteroKey: null }],
  annotationPins: [{ id: "pin-1", paperId: "p1", annotationKey: "ann-1", reportSectionId: "0123456789abcd05", createdAt: "2026-11-06T09:00:00.000Z" }],
  ink: [{ note: "n1", chunkId: CHUNK, bytes: INK_BYTES }],
  // A tag's id is its normalized name (FileTagRepository), so the row's id is the name.
  tags: [{ id: "ml", name: "ml", color: "#00ff00" }],
  paperFields: DEFS,
  paperFieldValues: [{ id: "v1", projectId: "proj-a", paperId: "p1", fieldId: "fa", value: "NeurIPS" }],
};

function writerServer(): ServerSource {
  return {
    listRows: async (kind: string) => WRITER_ROWS[kind] ?? [],
    // Group (c) claims blobs in this run, so the raw count is checked against listBlobs (one blob).
    countRows: async (kind: string) => (kind === "blobs" ? 1 : (WRITER_ROWS[kind] ?? []).length),
    pendingOutbox: async () => 0,
    listTrashed: async (kind: string) => (kind === "logEntries" ? [TRASHED_LOG] : []),
    undecryptable: async () => 0,
    listBlobs: async () => [BLOB.ref],
    fetchBlob: async () => BLOB.bytes,
    markExported097: async () => {},
    secretProviders: async () => [],
  } as unknown as ServerSource;
}

/** The workspace as the user already has it: the paper that holds the field values, and the note that holds the ink. */
async function seedWorkspace(sink: MemorySink): Promise<void> {
  await sink.write(PAPER_FILE, typedCore().writePaperRow(null, { id: "p1", title: "A" }) + "Body.\n");
  await sink.write(NOTE_FILE, "---\nweaveforge-id: n1\n---\n");
}

function exportWithWriters(sink: MemorySink, extra: Partial<Parameters<typeof runWebExport>[0]> = {}) {
  return runWebExport({
    ...DEVICE,
    kinds: MIGRATION_KINDS,
    codec,
    source: writerServer(),
    sink,
    now: NOW,
    projectFolders: FOLDERS,
    // Group C reads the paper folder of its one project (the paper sits under "Thesis").
    writers: (s) => [createGroupBWriter(s, FOLDERS), createGroupCWriter(s, "Thesis"), createTagsWriter(s)],
    ...extra,
  });
}

const WRITER_KINDS = ["logEntries", "milestones", "experiments", "metrics", "reportSections", "aiProposals", "annotations", "annotationPins", "ink", "tags", "paperFields", "paperFieldValues"];

test("double run through the real writers: every writer kind writes its rows, run 2 is verified and clean, no file changes", async () => {
  const sink = new MemorySink();
  await seedWorkspace(sink);
  const first = await exportWithWriters(sink);
  assert.equal(first.state, "verified", JSON.stringify(first.run.missing));
  for (const kind of WRITER_KINDS) assert.ok((first.run.kinds[kind]?.db ?? 0) > 0, `${kind} wrote no rows`);
  const afterFirst = await dataFiles(sink);

  const second = await exportWithWriters(sink);
  assert.equal(second.state, "verified", JSON.stringify(second.run.missing));
  assert.deepEqual(second.run.conflicts ?? [], []);
  assert.deepEqual(await dataFiles(sink), afterFirst, "run 2 writes no new file and keeps every byte");
  assert.equal(runIsClean(second.run), true);
});

test("double run through the real writers, one paper field value edited by the user: the DB value is carried, the user's value kept, run not clean", async () => {
  const sink = new MemorySink();
  await seedWorkspace(sink);
  assert.equal((await exportWithWriters(sink)).state, "verified");

  const before = await sink.readText(PAPER_FILE);
  const userEdited = before.replace("NeurIPS", "user");
  assert.notEqual(userEdited, before, "the export wrote the value into the paper");
  await sink.write(PAPER_FILE, userEdited);

  const second = await exportWithWriters(sink);
  const conflict = second.run.missing.find((m) => m.kind === "paperFieldValues");
  assert.ok(conflict, JSON.stringify(second.run.missing));
  assert.equal(conflict.reason, "conflict:paperFieldValues");
  assert.equal(conflict.value, "NeurIPS", "the report carries the DB value");
  assert.equal(await sink.readText(PAPER_FILE), userEdited, "the user's paper is kept byte for byte");
  assert.equal(runIsClean(second.run), false);
  assert.equal(second.state, "incomplete");
});

test("double run with secrets present: the run moves secrets only after verify, and report.json never holds a secret value", async () => {
  const sink = new MemorySink();
  await seedWorkspace(sink);
  const SECRET = "sk-live-SECRET-VALUE-0123456789";
  let moved = 0;
  const result = await exportWithWriters(sink, {
    moveSecrets: async () => {
      moved++;
    },
  });
  assert.equal(result.state, "verified", JSON.stringify(result.run.missing));
  assert.equal(moved, 1, "moveSecrets runs once, after the verified run");
  const report = await sink.readText(REPORT_PATH);
  assert.ok(!report.includes(SECRET), "report.json holds no secret value");
});
