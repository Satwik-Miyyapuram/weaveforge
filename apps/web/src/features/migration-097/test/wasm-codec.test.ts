import assert from "node:assert/strict";
import { test } from "node:test";
import { wasmFileCodec, type EntityCore } from "../infrastructure/wasm-codec";

// Fake core: records the entity kind it was called with and echoes ids.
function fakeCore(calls: string[]): EntityCore {
  return {
    entityRowFromFile: (kind, text) => {
      calls.push(`read:${kind}`);
      return text.startsWith(`${kind}:`) ? { id: text.slice(kind.length + 1) } : null;
    },
    entityFileFromRow: (kind, _existing, row) => {
      calls.push(`write:${kind}`);
      return `${kind}:${String(row.id)}`;
    },
    entityPath: (kind, row, root) => `${root ?? ""}${kind}/${String(row.id)}.md`,
  };
}

test("supports only the four kinds that have a wf-wasm codec", () => {
  const codec = wasmFileCodec(fakeCore([]));
  for (const kind of ["logEntries", "experiments", "reportSections", "readingLists"]) {
    assert.equal(codec.supports(kind), true, kind);
  }
  for (const kind of ["notes", "papers", "tags", "comments", "settings", "metrics"]) {
    assert.equal(codec.supports(kind), false, kind);
  }
});

test("toFile maps the contract kind to the wasm entity kind", () => {
  const calls: string[] = [];
  const codec = wasmFileCodec(fakeCore(calls), "proj/");
  const file = codec.toFile("logEntries", { id: "l1" });
  assert.deepEqual(file, { path: "proj/log_entry/l1.md", text: "log_entry:l1" });
  assert.deepEqual(calls, ["write:log_entry"]);
});

test("toRow returns null for an unsupported kind and for a file of another kind", () => {
  const calls: string[] = [];
  const codec = wasmFileCodec(fakeCore(calls));
  assert.equal(codec.toRow("tags", "tags/t1.json", "tags:t1"), null);
  assert.equal(codec.toRow("experiments", "x.md", "log_entry:l1"), null);
  assert.deepEqual(codec.toRow("experiments", "e.md", "experiment:e1"), { id: "e1" });
});

test("toFile throws for a kind without a codec", () => {
  const codec = wasmFileCodec(fakeCore([]));
  assert.throws(() => codec.toFile("notes", { id: "n1" }), /no wf-wasm codec for notes/);
});
