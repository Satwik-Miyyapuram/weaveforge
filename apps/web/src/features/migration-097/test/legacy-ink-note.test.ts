import { before, test } from "node:test";
import assert from "node:assert/strict";
import { runWebExport } from "../application/run-web-export";
import type { FileCodec, ServerSource } from "../domain/ports";
import { createGroupAWriter } from "../infrastructure/kind-writer-group-a";
import { MemorySink } from "../infrastructure/memory-sink";
import { loadTestCore } from "@/lib/test/load-test-core";
import { COMMENT_ROWS, NOTE_ROW } from "./group-a-fixtures";

before(loadTestCore);

// A legacy ink page (`notes/<name>.ink.md`) is the note the DB row names: the app opens it with its strokes in
// `notes/<name>.ink/`. A second `<slug>--<id>.note.md` with the same id would close those strokes.
const LEGACY = "notes/reading-plan.ink.md";
const legacyText = (updatedAt: string, text: string) =>
  `---\nweaveforge-id: "${NOTE_ROW.id}"\nweaveforge-type: ink_page\ntitle: "Reading plan"\nupdated-at: "${updatedAt}"\n` +
  `created-at: "2026-11-01T09:00:00.123Z"\nink-pages: 1\nink-paper: blank\nink-page-order: ["01M865N09W7EXPT1EFPJYN9T4P"]\n` +
  `ink-recognised: 0\nink-hand: right\n---\n${text}`;

/** The production codec has no codec for notes. */
const codec = { supports: () => false, toFile: () => { throw new Error("no codec"); }, toRow: () => null } as unknown as FileCodec;

function server(row: Record<string, unknown>, comments: Record<string, unknown>[] = []): ServerSource {
  return {
    listRows: async (k: string) => (k === "notes" ? [row] : k === "comments" ? comments : []),
    countRows: async (k: string) => (k === "notes" ? 1 : k === "comments" ? comments.length : 0),
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async () => [],
    fetchBlob: async () => new Uint8Array(),
    markExported097: async () => {},
    secretProviders: async () => [],
  } as unknown as ServerSource;
}

const run = (sink: MemorySink, row: Record<string, unknown>) =>
  runWebExport({ kinds: ["notes"], codec, source: server(row), sink, now: "2026-11-26T00:00:00.000Z", runDeviceId: "dev-alpha", writers: (g) => [createGroupAWriter(g)] });

const noteFiles = async (sink: MemorySink) => (await sink.list()).filter((p) => p.endsWith(".note.md"));

test("a legacy ink page newer than the row keeps the row: no second note file, the run counts it in files", async () => {
  const sink = new MemorySink();
  const text = legacyText("2026-11-25T12:57:54.751Z", "Handwritten plan\n");
  await sink.write(LEGACY, text);

  const result = await run(sink, NOTE_ROW);

  assert.deepEqual(await noteFiles(sink), [], "no .note.md beside the ink page");
  assert.equal(await sink.readText(LEGACY), text, "the user's ink page is left as it is");
  const notes = result.run.kinds.notes!;
  assert.deepEqual(notes.kept, [NOTE_ROW.id]);
  assert.equal(notes.files, notes.db);
  assert.deepEqual(result.run.missing, []);
});

test("a legacy ink page with the row's text keeps the row even when the row is newer", async () => {
  const sink = new MemorySink();
  const text = legacyText("2026-11-01T09:00:00.123Z", NOTE_ROW.body);
  await sink.write(LEGACY, text);
  const row = { ...NOTE_ROW, body: `<!-- weaveforge-ink ink-pages=1 ink-paper=blank ink-page-order=01M865N09W7EXPT1EFPJYN9T4P ink-recognised=0 ink-hand=right -->\n${NOTE_ROW.body}` };

  const result = await run(sink, row);

  assert.deepEqual(await noteFiles(sink), []);
  assert.deepEqual(result.run.kinds.notes!.kept, [NOTE_ROW.id]);
  assert.deepEqual(result.run.missing, []);
});

test("a row newer than its legacy ink page, with other text, is a conflict: the ink page stays and no second file is written", async () => {
  const sink = new MemorySink();
  const text = legacyText("2026-11-01T09:00:00.123Z", "Old text\n");
  await sink.write(LEGACY, text);

  const result = await run(sink, NOTE_ROW);

  assert.deepEqual(await noteFiles(sink), []);
  assert.equal(await sink.readText(LEGACY), text);
  assert.deepEqual(result.run.kinds.notes!.conflicts, [NOTE_ROW.id]);
  assert.ok(result.run.missing.some((m) => m.id === NOTE_ROW.id && m.reason === "conflict:notes"));
});

test("a legacy ink page with another id leaves the row to its own note file", async () => {
  const sink = new MemorySink();
  await sink.write(LEGACY, legacyText("2026-11-25T12:57:54.751Z", "x\n").replace(NOTE_ROW.id, "bbbbbbbb-0000-4000-8000-000000000009"));

  const result = await run(sink, NOTE_ROW);

  assert.equal((await noteFiles(sink)).length, 1);
  assert.equal(result.run.kinds.notes!.kept, undefined);
  assert.deepEqual(result.run.missing, []);
});

test("a comment on a kept legacy ink page lands beside that page", async () => {
  const sink = new MemorySink();
  await sink.write(LEGACY, legacyText("2026-11-25T12:57:54.751Z", "Handwritten plan\n"));
  const comment = COMMENT_ROWS.find((c) => c.resourceType === "vault_page")!;

  const result = await runWebExport({
    kinds: ["notes", "comments"], codec, source: server(NOTE_ROW, [comment]), sink, now: "2026-11-26T00:00:00.000Z", runDeviceId: "dev-alpha",
    writers: (g) => [createGroupAWriter(g)],
  });

  assert.deepEqual(result.run.missing, []);
  const commentFiles = (await sink.list()).filter((p) => !p.startsWith(".weaveforge/") && p !== LEGACY);
  assert.equal(commentFiles.length, 1);
  assert.ok(commentFiles[0]!.startsWith("notes/reading-plan"), commentFiles[0]);
});
