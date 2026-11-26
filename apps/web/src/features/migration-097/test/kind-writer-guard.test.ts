import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { runWebExport } from "../application/run-web-export";
import { conflictCopyPath } from "../domain/conflict-path";
import { REPORT_DIR } from "../domain/report";
import type { FileCodec, Row, ServerSource } from "../domain/ports";
import { createGroupBWriter } from "../infrastructure/kind-writer-group-b";
import { MemorySink } from "../infrastructure/memory-sink";

before(loadTestCore);

const NOW = "2026-11-22T00:00:00.000Z";
const ROOTS: ReadonlyMap<string, string> = new Map([["proj-1", ""]]);
const LOG_ROW = {
  projectId: "proj-1",
  id: "0123456789abcd01",
  entryDate: "2026-11-01",
  kind: "daily",
  body: "Ran the ablation",
  links: [],
  createdAt: "2026-11-01T09:00:00.000Z",
};

const noCodec: FileCodec = {
  supports: () => false,
  toFile: () => {
    throw new Error("codec unused: the kind writer owns logEntries");
  },
  toRow: () => null,
};

function server(rows: Row[]): ServerSource {
  return {
    listRows: async (kind: string) => (kind === "logEntries" ? rows : []),
    countRows: async (kind: string) => (kind === "logEntries" ? rows.length : 0),
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async () => [],
    fetchBlob: async () => new Uint8Array(),
    markExported097: async () => {},
    secretProviders: async () => [],
  } as unknown as ServerSource;
}

/** The file the log writer produces for LOG_ROW, and its bytes, learned from a scratch sink. */
async function writtenLog(): Promise<{ path: string; text: string }> {
  const scratch = new MemorySink();
  await createGroupBWriter(scratch, ROOTS).write("logEntries", LOG_ROW);
  const paths = scratch.paths();
  assert.equal(paths.length, 1, "one log entry is one file");
  return { path: paths[0]!, text: await scratch.readText(paths[0]!) };
}

test("kind writer guard: a differing file at a log entry's path is kept and the DB version lands at a conflict copy", async () => {
  const { path, text } = await writtenLog();
  const sink = new MemorySink();
  // Still a readable entity with the same id, so the repo reaches the write; only the body differs.
  const userEdit = text.replace("Ran the ablation", "my own edit, not the database");
  assert.notEqual(userEdit, text, "the edit changes the file");
  await sink.write(path, userEdit);

  const result = await runWebExport({
    runDeviceId: "dev-test",
    kinds: ["logEntries"],
    codec: noCodec,
    source: server([LOG_ROW]),
    sink,
    now: NOW,
    writers: (guarded) => [createGroupBWriter(guarded, ROOTS)],
  });

  assert.equal(await sink.readText(path), userEdit, "the user's file is never overwritten");
  assert.equal(
    await sink.readText(conflictCopyPath(path, 1)),
    text.replace(/^weaveforge-id:/m, "conflictOf:"),
    "the DB version sits in the conflict copy, under conflictOf so no second file holds the id",
  );
  assert.deepEqual(result.run.conflicts, [conflictCopyPath(path, 1)]);
});

test("kind writer guard: an identical file at a log entry's path is a no-op with no conflict", async () => {
  const { path, text } = await writtenLog();
  const sink = new MemorySink();
  await sink.write(path, text);

  const result = await runWebExport({
    runDeviceId: "dev-test",
    kinds: ["logEntries"],
    codec: noCodec,
    source: server([LOG_ROW]),
    sink,
    now: NOW,
    writers: (guarded) => [createGroupBWriter(guarded, ROOTS)],
  });

  assert.equal(await sink.readText(path), text);
  assert.deepEqual(result.run.conflicts ?? [], []);
  assert.deepEqual(
    sink.paths().filter((p) => !p.startsWith(`${REPORT_DIR}/`)),
    [path],
    "no copy is written for identical content",
  );
});
