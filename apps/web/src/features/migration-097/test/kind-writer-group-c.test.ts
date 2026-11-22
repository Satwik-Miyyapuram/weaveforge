import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { loadCore } from "@/lib/rust-core";
import { MemorySink } from "../infrastructure/memory-sink";
import { createGroupCWriter } from "../infrastructure/kind-writer-group-c";

// The Rust core (wasm) backs the annotation and ink paths; load it once for this file.
before(async () => {
  await loadCore(readFileSync(new URL("../../../../../../packages/wf-wasm/pkg/wf_wasm_bg.wasm", import.meta.url)));
});

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function fresh() {
  const sink = new MemorySink();
  return { sink, writer: createGroupCWriter(sink, "proj") };
}

test("kinds: group c owns exactly annotations, annotationPins, blobs, ink", () => {
  const { writer } = fresh();
  assert.deepEqual([...writer.kinds].sort(), ["annotationPins", "annotations", "blobs", "ink"]);
});

test("annotations: a written row is listed back with the carried fields", async () => {
  const { writer } = fresh();
  // Gap: `paperFile` is not a PostgREST column; the exporter must supply the paper's workspace path.
  const row = {
    id: "ann-1",
    paperId: "p1",
    paperFile: "papers/x.paper.md",
    type: "highlight",
    color: "#ff0000",
    text: "hello",
    comment: "note",
    tags: ["t1"],
    anchor: { pageIndex: 0 },
    sortIndex: "00000|000000|00000",
    pageIndex: 0,
  };
  await writer.write("annotations", row);
  const back = await writer.readBack("annotations");
  assert.equal(back.length, 1);
  const pick = (r: Record<string, unknown>) => ({
    id: r.id,
    paperId: r.paperId,
    type: r.type,
    color: r.color,
    text: r.text,
    comment: r.comment,
    tags: r.tags,
    anchor: r.anchor,
    sortIndex: r.sortIndex,
  });
  assert.deepEqual(pick(back[0]!), pick(row));
});

test("annotationPins: a written row is listed back on the carried fields", async () => {
  const { writer } = fresh();
  const row = { paperId: "p1", annotationKey: "k1", reportSectionId: "s1" };
  await writer.write("annotationPins", row);
  const back = await writer.readBack("annotationPins");
  assert.equal(back.length, 1);
  assert.deepEqual(
    { paperId: back[0]!.paperId, annotationKey: back[0]!.annotationKey, reportSectionId: back[0]!.reportSectionId },
    row,
  );
});

test("annotationPins: gap, the row id and createdAt are not preserved by save()", async () => {
  const { writer } = fresh();
  await writer.write("annotationPins", {
    id: "annotation-pin-server-1",
    paperId: "p1",
    annotationKey: "k1",
    reportSectionId: "s1",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const [back] = await writer.readBack("annotationPins");
  assert.notEqual(back?.id, "annotation-pin-server-1");
  assert.notEqual(back?.createdAt, "2026-01-01T00:00:00.000Z");
});

test("blobs: a written blob is listed back with bucket, path and sha256", async () => {
  const { writer } = fresh();
  const bytes = new Uint8Array([10, 20, 30, 40]);
  const sha256 = await sha256Hex(bytes);
  await writer.write("blobs", { bucket: "images", path: "a/b.webp", sha256, bytes });
  const back = await writer.readBack("blobs");
  assert.equal(back.length, 1);
  assert.deepEqual({ bucket: back[0]!.bucket, path: back[0]!.path, sha256: back[0]!.sha256 }, {
    bucket: "images",
    path: "a/b.webp",
    sha256,
  });
});

test("blobs: contentType is carried through the sidecar and read back", async () => {
  const { writer } = fresh();
  const bytes = new Uint8Array([7, 8, 9]);
  const sha256 = await sha256Hex(bytes);
  await writer.write("blobs", { bucket: "images", path: "w.webp", sha256, bytes, contentType: "image/webp" });
  const back = await writer.readBack("blobs");
  assert.equal(back[0]?.contentType, "image/webp");
});

test("blobs: a sha256 that does not match the bytes throws", async () => {
  const { writer } = fresh();
  const bytes = new Uint8Array([1, 2, 3]);
  await assert.rejects(
    writer.write("blobs", { bucket: "images", path: "c.webp", sha256: "0".repeat(64), bytes }),
    /sha256/,
  );
});

test("ink: a written chunk is read back with the same bytes", async () => {
  const { sink, writer } = fresh();
  // The note must already be on disk: ink pairs with its note file by weaveforge-id.
  await sink.write("notes/a.note.md", "---\nweaveforge-id: n1\n---\n");
  const bytes = new Uint8Array([7, 8, 9, 250]);
  await writer.write("ink", { note: "n1", chunkId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", bytes });
  const back = await writer.readBack("ink");
  assert.equal(back.length, 1);
  assert.equal(back[0]!.note, "n1");
  assert.equal(back[0]!.chunkId, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
  assert.deepEqual([...(back[0]!.bytes as Uint8Array)], [...bytes]);
});

test("unknown kind is rejected on write and on readBack", async () => {
  const { writer } = fresh();
  await assert.rejects(writer.write("nope", {}), /unknown kind/);
  await assert.rejects(writer.readBack("nope"), /unknown kind/);
});

test("annotations: a re-run of the same row is idempotent (no ConflictError, one row back)", async () => {
  const { writer } = fresh();
  const row = {
    id: "ann-rerun",
    paperId: "p9",
    paperFile: "papers/r.paper.md",
    type: "highlight",
    color: "#00ff00",
    text: "again",
    comment: "",
    tags: [],
    anchor: { pageIndex: 1 },
    sortIndex: "0001",
    pageIndex: 1,
  };
  await writer.write("annotations", row);
  await writer.write("annotations", row);
  const back = await writer.readBack("annotations");
  assert.equal(back.length, 1);
  assert.equal(back[0]?.id, "ann-rerun");
});
