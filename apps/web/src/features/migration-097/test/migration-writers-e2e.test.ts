/**
 * End to end: an account with a row in every kind that has no wasm codec reaches "verified" through
 * runWebExport with the production writers, twice. Each such kind is archived losslessly; kinds with a
 * files-first home are also written there when their parent (paper, experiment) exists.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { MIGRATION_KINDS } from "../domain/report";
import type { FileCodec, Row, ServerSource } from "../domain/ports";
import { runWebExport } from "../application/run-web-export";
import { MemorySink } from "../infrastructure/memory-sink";
import { sinkAsWorkspaceFs } from "../infrastructure/sink-workspace-fs";
import { archivePath } from "../infrastructure/kind-writer-archive";
import { ARCHIVE_KINDS, createMigrationWriters } from "../infrastructure/migration-writers";
import { FilePaperRepository } from "../../papers/infrastructure/file-paper-repository";
import { FilePaperRelationRepository } from "@/backend/providers/files/file-relation-repo";
import { FileMilestoneRepository } from "../../plan/infrastructure/file-milestone-repo";
import { BARE_PAPER_ROW, PAPER_ROW, USER } from "./group-a-fixtures";

before(loadTestCore);

const NOW = "2026-11-22T00:00:00.000Z";
const P1 = PAPER_ROW.id;
const P2 = BARE_PAPER_ROW.id;
const GONE = "bbbbbbbb-0000-4000-8000-0000000000ff";

const codec: FileCodec = {
  supports: () => false,
  toFile: () => {
    throw new Error("no codec");
  },
  toRow: () => null,
} as unknown as FileCodec;

const ROWS: Record<string, Row[]> = {
  papers: [PAPER_ROW, BARE_PAPER_ROW],
  tags: [{ id: "t1", userId: USER, name: "ml", color: "#ff0000" }],
  paperFields: [
    { id: "fa", userId: USER, projectId: "proj-a", name: "Venue", kind: "text", options: [], sortOrder: 0 },
    { id: "fb", userId: USER, projectId: "proj-b", name: "Venue", kind: "select", options: ["ICML"], sortOrder: 0 },
  ],
  paperFieldValues: [
    { id: "v1", userId: USER, projectId: "proj-a", paperId: P1, fieldId: "fa", value: "NeurIPS" },
    { id: "v2", userId: USER, projectId: "proj-a", paperId: GONE, fieldId: "fa", value: "orphan" },
  ],
  relations: [
    { id: "r1", userId: USER, fromPaper: P1, toPaper: P2, relation: "cites", note: null, source: "manual", createdAt: NOW },
    { id: "r2", userId: USER, fromPaper: P1, toPaper: GONE, relation: "extends", note: "x", source: "manual", createdAt: NOW },
  ],
  screening: [{ id: "s1", projectId: "proj-a", paperId: P1, reviewerId: USER, decision: "include", note: null, createdAt: NOW }],
  milestones: [
    {
      userId: USER, projectId: "proj-a", id: "0123456789abcd03", title: "Submit draft", description: "Chapters 1 to 3",
      status: "in_progress", targetDate: "2026-12-01", dependencies: [], compute: [], createdAt: "2026-11-02T09:00:00.000Z",
    },
  ],
  metrics: [{ userId: USER, experimentId: "missing-exp", metric: "loss", step: 1, value: 0.5, wallTime: NOW }],
  annotations: [{ id: "a1", userId: USER, paperId: GONE, type: "highlight", color: "yellow", text: "t", sortIndex: "0", pageIndex: 0 }],
  annotationPins: [{ id: "ap1", userId: USER, paperId: P1, annotationKey: "k1", reportSectionId: "rs1", createdAt: NOW }],
  libraryPins: [
    { id: "lp1", userId: USER, projectId: "proj-a", resourceType: "paper", resourceId: P1, ownerId: USER, createdAt: NOW },
    { id: "lp2", userId: USER, projectId: "proj-a", resourceType: "milestone", resourceId: "0123456789abcd03", ownerId: USER, createdAt: NOW },
  ],
  settings: [{ userId: USER, zoteroApiKey: "zk-secret", zoteroLibrary: "users/1", semanticScholarKey: "ss-secret", credentialsEnc: "enc-secret", integrations: { github: "gh-secret" }, updatedAt: NOW }],
  aiProposals: [
    {
      userId: USER, projectId: "proj-a", id: "0123456789abcd06", kind: "create_log_entry", resourceId: "0123456789abcd01",
      content: "Draft log entry", createdAt: "2026-11-05T09:00:00.000Z", status: "pending", sourceLinks: [],
    },
  ],
};

function server(): ServerSource {
  return {
    listRows: async (kind: string) => ROWS[kind] ?? [],
    countRows: async (kind: string) => (ROWS[kind] ?? []).length,
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async () => [],
    fetchBlob: async () => new Uint8Array(),
    markExported097: async () => {},
    secretProviders: async () => [],
  } as unknown as ServerSource;
}

const exportRun = (sink: MemorySink) =>
  runWebExport({ runDeviceId: "dev-archive", kinds: MIGRATION_KINDS, codec, source: server(), sink, now: NOW, writers: (s) => createMigrationWriters(s, codec) });

/** Kinds the production wasm codec writes (wasm-codec.ts), and blobs/ink, which the run handles itself. */
const NOT_WRITER_KINDS = new Set(["logEntries", "experiments", "reportSections", "readingLists", "blobs", "ink"]);

test("every migration kind without a codec is claimed by a writer", () => {
  const claimed = new Set(createMigrationWriters(new MemorySink(), codec).flatMap((w) => [...w.kinds]));
  for (const kind of MIGRATION_KINDS) if (!NOT_WRITER_KINDS.has(kind)) assert.ok(claimed.has(kind), kind);
  for (const kind of Object.keys(ROWS)) assert.ok(claimed.has(kind), kind);
  for (const kind of ["screening", "settings", "relations", "libraryPins", "milestones", "metrics"]) assert.ok(ARCHIVE_KINDS.includes(kind), kind);
});

test("the account verifies, twice, with every row archived and no secret on disk", async () => {
  const sink = new MemorySink();
  const first = await exportRun(sink);
  assert.equal(first.state, "verified", JSON.stringify(first.run.missing));
  const second = await exportRun(sink);
  assert.equal(second.state, "verified", JSON.stringify(second.run.missing));

  for (const kind of ARCHIVE_KINDS) {
    const archived = JSON.parse(await sink.readText(archivePath(kind))) as Row[];
    assert.equal(archived.length, (ROWS[kind] ?? []).length, kind);
  }
  for (const path of await sink.list()) {
    const text = await sink.readText(path);
    for (const secret of ["zk-secret", "ss-secret", "enc-secret", "gh-secret"]) assert.ok(!text.includes(secret), `${secret} in ${path}`);
  }
});

test("rows with a files-first home are written there too", async () => {
  const sink = new MemorySink();
  assert.equal((await exportRun(sink)).state, "verified");
  const fs = sinkAsWorkspaceFs(sink);
  const papers = new FilePaperRepository(fs, "");
  const relations = await new FilePaperRelationRepository(papers, fs, () => "").list();
  assert.deepEqual(relations.map((r) => r.id), ["r1"]);
  assert.deepEqual(await papers.listPinnedIds(), [P1]);
  assert.deepEqual((await new FileMilestoneRepository(fs, "").list()).map((m) => m.id), ["0123456789abcd03"]);
  const settings = JSON.parse(await sink.readText(".weaveforge/settings.json")) as Record<string, unknown>;
  assert.ok(JSON.stringify(settings.tags).includes("#ff0000"));
});
