import { before, test } from "node:test";
import assert from "node:assert/strict";
import { runWebExport } from "../application/run-web-export";
import type { FileCodec, ServerSource } from "../domain/ports";
import { createMigrationWriters } from "../infrastructure/migration-writers";
import { createProjectRouter } from "../infrastructure/project-router";
import { MemorySink } from "../infrastructure/memory-sink";
import { loadTestCore } from "@/lib/test/load-test-core";
import { NOTE_ROW } from "./group-a-fixtures";

before(loadTestCore);

// The production path: notes go through the project router, so a legacy ink page in a project folder is kept there.
const FOLDER = "thesis--aaaaaa";
const LEGACY = `${FOLDER}/notes/reading-plan.ink.md`;
const legacy =
  `---\nweaveforge-id: "${NOTE_ROW.id}"\nweaveforge-type: ink_page\ntitle: "Reading plan"\nupdated-at: "2026-11-25T12:57:54.751Z"\n` +
  `created-at: "2026-11-01T09:00:00.123Z"\nink-pages: 1\n---\nHandwritten plan\n`;

const codec = { supports: () => false, toFile: () => { throw new Error("no codec"); }, toRow: () => null } as unknown as FileCodec;

const source = {
  listRows: async (k: string) => (k === "notes" ? [NOTE_ROW] : []),
  countRows: async (k: string) => (k === "notes" ? 1 : 0),
  pendingOutbox: async () => 0,
  listTrashed: async () => [],
  undecryptable: async () => 0,
  listBlobs: async () => [],
  fetchBlob: async () => new Uint8Array(),
  markExported097: async () => {},
  secretProviders: async () => [],
} as unknown as ServerSource;

test("a legacy ink page kept in a project folder counts as the note's file through the routed writers", async () => {
  const sink = new MemorySink();
  await sink.write(LEGACY, legacy);
  const router = createProjectRouter([{ id: NOTE_ROW.projectId, folder: FOLDER }]);

  const result = await runWebExport({
    kinds: ["notes"], codec, source, sink, now: "2026-11-26T00:00:00.000Z", runDeviceId: "dev-alpha",
    writers: (g) => createMigrationWriters(g, codec, router),
  });

  assert.deepEqual((await sink.list()).filter((p) => p.endsWith(".note.md")), []);
  assert.equal(await sink.readText(LEGACY), legacy);
  const notes = result.run.kinds.notes!;
  assert.deepEqual(notes.kept, [NOTE_ROW.id]);
  assert.equal(notes.files, notes.db);
  assert.deepEqual(result.run.missing, []);
});
