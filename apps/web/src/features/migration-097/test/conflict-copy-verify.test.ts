import assert from "node:assert/strict";
import { test } from "node:test";
import { runWebExport } from "../application/run-web-export";
import type { FileCodec, ServerSource } from "../domain/ports";
import { MemorySink } from "../infrastructure/memory-sink";

const NOW = "2026-11-22T00:00:00.000Z";
const ORIGINAL = "logEntries/x1.json";
const OLD_COPY = "logEntries/x1 (conflict).json";
const THIS_COPY = "logEntries/x1 (conflict 2).json";

// A row is its JSON; a file with no id is not a row (the copy form before verify maps it back).
const codec: FileCodec = {
  supports: (kind) => kind === "logEntries",
  toFile: (kind, row) => ({ path: `${kind}/${String(row.id)}.json`, text: JSON.stringify(row) }),
  toRow: (_kind, _path, text) => {
    const row = JSON.parse(text) as Record<string, unknown>;
    return typeof row.id === "string" ? row : null;
  },
};

function server(): ServerSource {
  return {
    listRows: async (kind: string) => (kind === "logEntries" ? [{ id: "x1", v: "DB" }] : []),
    countRows: async (kind: string) => (kind === "logEntries" ? 1 : 0),
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async () => [],
    fetchBlob: async () => new Uint8Array(),
    markExported097: async () => {},
    secretProviders: async () => [],
  } as unknown as ServerSource;
}

test("conflict copies: a copy left by an earlier run is listed but never decoded (verify still passes)", async () => {
  const sink = new MemorySink();
  await sink.write(ORIGINAL, JSON.stringify({ id: "x1", v: "user" }));
  // Left behind by an earlier run of this device: it carries an id, as the pre-conflictOf copies did.
  await sink.write(OLD_COPY, JSON.stringify({ id: "x1", v: "old" }));

  const result = await runWebExport({ kinds: ["logEntries"], codec, source: server(), sink, now: NOW, runDeviceId: "dev-alpha" });

  assert.deepEqual(result.run.missing, [], "verify passes with the copy present");
  assert.equal(result.state, "incomplete", "a run with a conflict copy is never verified");
  assert.equal(await sink.readText(OLD_COPY), JSON.stringify({ id: "x1", v: "old" }), "earlier copy untouched");
  assert.deepEqual(result.run.conflicts, [THIS_COPY]);
});

test("conflict copies: this run's copy carries conflictOf instead of id, and verify maps it back to its row", async () => {
  const sink = new MemorySink();
  await sink.write(ORIGINAL, JSON.stringify({ id: "x1", v: "user" }));

  const result = await runWebExport({ kinds: ["logEntries"], codec, source: server(), sink, now: NOW, runDeviceId: "dev-alpha" });

  assert.deepEqual(result.run.missing, [], "verify passes with the copy present");
  assert.equal(result.state, "incomplete", "a run with a conflict copy is never verified");
  const copy = JSON.parse(await sink.readText("logEntries/x1 (conflict).json")) as Record<string, unknown>;
  assert.equal(copy.conflictOf, "x1");
  assert.equal(copy.id, undefined, "no id in the copy, so files mode never sees two files with one id");
  assert.equal(copy.v, "DB");
});

// The real codec writes markdown whose frontmatter names the row with `weaveforge-id:` and its kind with `weaveforge-type:`.
const mdCodec: FileCodec = {
  supports: (kind) => kind === "logEntries",
  toFile: (kind, row) => ({
    path: `${kind}/${String(row.id)}.md`,
    text: `---\nweaveforge-id: ${String(row.id)}\nweaveforge-type: log_entry\nv: ${String(row.v)}\n---\n`,
  }),
  toRow: (_kind, _path, text) => {
    const id = /^weaveforge-id: (.*)$/m.exec(text)?.[1];
    const v = /^v: (.*)$/m.exec(text)?.[1];
    return id ? { id, v } : null;
  },
};

test("conflict copies: a codec markdown copy carries conflictOf, never a second weaveforge-id, and still verifies", async () => {
  const sink = new MemorySink();
  const original = "logEntries/x1.md";
  const user = "---\nweaveforge-id: x1\nweaveforge-type: log_entry\nv: user\n---\n";
  await sink.write(original, user);

  const result = await runWebExport({ kinds: ["logEntries"], codec: mdCodec, source: server(), sink, now: NOW, runDeviceId: "dev-alpha" });

  assert.deepEqual(result.run.missing, [], "verify maps the copy back to its row");
  assert.equal(await sink.readText(original), user, "the user's file is kept");
  const copy = await sink.readText("logEntries/x1 (conflict).md");
  assert.doesNotMatch(copy, /^weaveforge-id:/m, "files mode never sees two files with one id");
  assert.match(copy, /^conflictOf: x1$/m);
  assert.match(copy, /^v: DB$/m);
});
