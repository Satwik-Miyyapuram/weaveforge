/**
 * End to end: an account with notes, papers and comments (and nothing else) reaches "verified" through
 * runWebExport with the group (a) writer, and again on a second run. Without the writer the same account
 * cannot verify: the wasm codec has no codec for these kinds.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { MIGRATION_KINDS } from "../domain/report";
import type { FileCodec, Row, ServerSource } from "../domain/ports";
import { runWebExport } from "../application/run-web-export";
import { createGroupAWriter } from "../infrastructure/kind-writer-group-a";
import { MemorySink } from "../infrastructure/memory-sink";
import { sinkAsWorkspaceFs } from "../infrastructure/sink-workspace-fs";
import { FileCommentRepository } from "../../sharing/infrastructure/file-comment-repository";
import { FileNoteRepository } from "../../notes/infrastructure/file-note-repo";
import { FilePaperRepository } from "../../papers/infrastructure/file-paper-repository";
import { BARE_PAPER_ROW, CHILD_NOTE_ROW, COMMENT_ROWS, NOTE_ROW, PAPER_ROW } from "./group-a-fixtures";

before(loadTestCore);

const NOW = "2026-11-22T00:00:00.000Z";

/** The production codec has no codec for notes, papers or comments. */
const codec: FileCodec = {
  supports: () => false,
  toFile: () => {
    throw new Error("no codec");
  },
  toRow: () => null,
} as unknown as FileCodec;

function server(): ServerSource {
  const rows: Record<string, Row[]> = {
    notes: [NOTE_ROW, CHILD_NOTE_ROW],
    papers: [PAPER_ROW, BARE_PAPER_ROW],
    comments: COMMENT_ROWS,
  };
  return {
    listRows: async (kind: string) => rows[kind] ?? [],
    countRows: async (kind: string) => (rows[kind] ?? []).length,
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async () => [],
    fetchBlob: async () => new Uint8Array(),
    markExported097: async () => {},
    secretProviders: async () => [],
  } as unknown as ServerSource;
}

function exportRun(sink: MemorySink, withWriters: boolean) {
  return runWebExport({
    runDeviceId: "dev-group-a",
    kinds: MIGRATION_KINDS,
    codec,
    source: server(),
    sink,
    now: NOW,
    writers: withWriters ? (s) => [createGroupAWriter(s)] : undefined,
  });
}

test("without the group (a) writer, notes, papers and comments cannot verify", async () => {
  const result = await exportRun(new MemorySink(), false);
  assert.notEqual(result.state, "verified");
  const kinds = new Set(result.run.missing?.map((m) => m.kind));
  for (const kind of ["notes", "papers", "comments"]) assert.ok(kinds.has(kind), `${kind} is missing`);
});

test("with the group (a) writer, the account verifies, twice", async () => {
  const sink = new MemorySink();
  const first = await exportRun(sink, true);
  assert.equal(first.state, "verified", JSON.stringify(first.run.missing));
  const second = await exportRun(sink, true);
  assert.equal(second.state, "verified", JSON.stringify(second.run.missing));
});

test("the exported comments are what the app's comment repository lists for each paper and note", async () => {
  const sink = new MemorySink();
  assert.equal((await exportRun(sink, true)).state, "verified");
  const fs = sinkAsWorkspaceFs(sink);
  const notes = new FileNoteRepository(fs, "");
  const papers = new FilePaperRepository(fs, "");
  const itemFileOf = async (type: string, id: string) =>
    type === "paper" ? papers.pathOf(id) : type === "vault_page" ? notes.pathOf(id) : null;
  const repo = new FileCommentRepository(fs, itemFileOf, "");
  const onPaper = await repo.list("paper", PAPER_ROW.id);
  assert.deepEqual(onPaper.map((c) => c.body), [COMMENT_ROWS[0]!.body, COMMENT_ROWS[1]!.body]);
  assert.deepEqual(onPaper[0]?.anchor, { quote: "sequence transduction", prefix: "The dominant ", suffix: " models" });
  assert.equal(onPaper[1]?.parentId, COMMENT_ROWS[0]!.id);
  assert.deepEqual((await repo.list("vault_page", NOTE_ROW.id)).map((c) => c.id), [COMMENT_ROWS[2]!.id]);
});

test("a re-run after a crash that left no run record still verifies: identical files are not conflicts", async () => {
  const sink = new MemorySink();
  assert.equal((await exportRun(sink, true)).state, "verified");
  for (const p of await sink.list()) if (p.startsWith(".weaveforge/")) await sink.remove(p);
  const before = new Map<string, string>();
  for (const p of await sink.list()) before.set(p, await sink.readText(p));
  const again = await exportRun(sink, true);
  assert.equal(again.state, "verified", JSON.stringify(again.run.missing));
  for (const [p, text] of before) assert.equal(await sink.readText(p), text, p);
});

test("a user's edit to an exported note is kept; the DB copy holds conflictOf, never a second weaveforge-id", async () => {
  const sink = new MemorySink();
  assert.equal((await exportRun(sink, true)).state, "verified");
  const path = (await sink.list()).find((p) => p.startsWith("notes/reading-plan") && p.endsWith(".note.md"))!;
  const edited = (await sink.readText(path)).replace("Second line", "My own line");
  await sink.write(path, edited);
  const again = await exportRun(sink, true);
  assert.notEqual(again.state, "verified");
  assert.equal(await sink.readText(path), edited);
  const reasons = again.run.missing?.filter((m) => m.id === NOTE_ROW.id).map((m) => m.reason);
  assert.deepEqual(reasons, ["conflict:notes"], "a save kept as a conflict copy is a conflict, not a write failure");
  const ids: string[] = [];
  for (const p of await sink.list()) {
    if (p.startsWith(".weaveforge/")) continue;
    const text = await sink.readText(p);
    if (text.includes(`weaveforge-id: ${NOTE_ROW.id}`)) ids.push(p);
  }
  assert.deepEqual(ids, [path], "only the user's file carries the note's id");
  const copy = (await sink.list()).find(
    (p) => p !== path && p.startsWith("notes/reading-plan") && p.includes(".note") && !p.endsWith(".comments.json"),
  );
  assert.ok(copy, "the DB version is kept in a conflict copy");
  assert.match(await sink.readText(copy), new RegExp(`conflictOf: ${NOTE_ROW.id}`));
});

test("a local-only note already in the workspace is kept byte for byte and does not block verified", async () => {
  const sink = new MemorySink();
  const local = "---\nweaveforge-id: local-1\nweaveforge-type: vault_page\ntitle: Mine\n---\nmy text\n";
  await sink.write("notes/mine--local-1.note.md", local);
  const result = await exportRun(sink, true);
  assert.equal(result.state, "verified", JSON.stringify(result.run.missing));
  assert.equal(await sink.readText("notes/mine--local-1.note.md"), local);
});

test("a user's edit to an exported comment sidecar is kept; the run is not verified", async () => {
  const sink = new MemorySink();
  assert.equal((await exportRun(sink, true)).state, "verified");
  const sidecar = (await sink.list()).find((p) => p.startsWith("papers/") && p.endsWith(".comments.json"))!;
  const edited = (await sink.readText(sidecar)).replace(String(COMMENT_ROWS[0]!.body), "my edit");
  await sink.write(sidecar, edited);
  const again = await exportRun(sink, true);
  assert.notEqual(again.state, "verified");
  assert.equal(await sink.readText(sidecar), edited);
});

test("a user's note the run merges into in place (same body, own quoting, a DB key missing) gets no duplicate copy note", async () => {
  const first = new MemorySink();
  assert.equal((await exportRun(first, true)).state, "verified");
  const path = (await first.list()).find((p) => p.startsWith("notes/reading-plan") && p.endsWith(".note.md"))!;
  // The user's own file from before the run: unquoted title and no order key; the body is the DB's.
  const own = (await first.readText(path)).replace(/^title: .*$/m, "title: Reading plan").replace(/^order: .*\n/m, "");
  const sink = new MemorySink();
  await sink.write(path, own);
  const result = await exportRun(sink, true);
  const notes = (await sink.list()).filter((p) => p.startsWith("notes/") && p.endsWith(".note.md"));
  assert.equal(notes.filter((p) => p.startsWith("notes/reading-plan")).length, 1, `no copy note: ${notes.join(", ")}`);
  assert.deepEqual(result.run.kinds.notes?.kept, [NOTE_ROW.id]);
  assert.deepEqual(result.run.missing?.filter((m) => m.kind === "notes"), []);
});
