import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { ConflictError } from "@weaveforge/core";
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
    paperFile: "proj/papers/x.paper.md",
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

test("annotations: readBack derives the top-level pageIndex from the anchor (DB column shape)", async () => {
  const { writer } = fresh();
  const row = {
    id: "ann-page",
    paperId: "p9",
    paperFile: "proj/papers/p.paper.md",
    type: "highlight",
    color: "#0000ff",
    text: "page three",
    comment: "",
    tags: [],
    anchor: { pageIndex: 3 },
    sortIndex: "0003",
    pageIndex: 3,
  };
  await writer.write("annotations", row);
  const back = await writer.readBack("annotations");
  assert.equal(back.length, 1);
  assert.equal(back[0]!.pageIndex, 3);
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

test("blobs: a contentType that the extension does not imply reads back as written", async () => {
  const { writer } = fresh();
  const bin = new Uint8Array([1, 2, 3]);
  const scan = new Uint8Array([4, 5, 6]);
  await writer.write("blobs", { bucket: "files", path: "dump.bin", sha256: await sha256Hex(bin), bytes: bin, contentType: "application/x-custom-dump" });
  await writer.write("blobs", { bucket: "images", path: "scan", sha256: await sha256Hex(scan), bytes: scan, contentType: "image/png" });
  const back = await writer.readBack("blobs");
  const type = (path: string) => back.find((r) => r.path === path)?.contentType;
  assert.equal(type("dump.bin"), "application/x-custom-dump", "a .bin keeps its stored type, not octet-stream");
  assert.equal(type("scan"), "image/png", "an extensionless file keeps its stored type");
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

test("annotations: a same id with different content is a conflict, and the existing row is kept", async () => {
  const { writer } = fresh();
  const row = {
    id: "ann-conflict",
    paperId: "p8",
    paperFile: "proj/papers/c.paper.md",
    type: "highlight",
    color: "#00ff00",
    text: "original",
    comment: "",
    tags: [],
    anchor: { pageIndex: 1 },
    sortIndex: "0001",
    pageIndex: 1,
  };
  await writer.write("annotations", row);
  await assert.rejects(
    () => writer.write("annotations", { ...row, text: "changed" }),
    (err: unknown) => err instanceof ConflictError && /conflict: annotation ann-conflict/.test(err.message),
  );
  const back = await writer.readBack("annotations");
  assert.equal(back.length, 1);
  assert.equal(back[0]?.text, "original");
});

test("annotations: a re-run of the same row is idempotent (no ConflictError, one row back)", async () => {
  const { writer } = fresh();
  const row = {
    id: "ann-rerun",
    paperId: "p9",
    paperFile: "proj/papers/r.paper.md",
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

test("annotations: readBack scans the sidecar files, not this writer's memory", async () => {
  const { sink, writer } = fresh();
  await writer.write("annotations", {
    id: "ann-1",
    paperId: "p1",
    paperFile: "proj/papers/x.paper.md",
    type: "highlight",
    color: "#ff0000",
    text: "a",
    comment: "",
    tags: [],
    anchor: { pageIndex: 0 },
    sortIndex: "00000|000000|00000",
    pageIndex: 0,
  });
  // A sidecar written outside this writer (another editor, or an earlier run) must be listed too.
  const { typedCore } = await import("@/lib/rust-core");
  const outside = {
    id: "ann-outside",
    origin: "local",
    zoteroKey: null,
    type: "highlight",
    color: "#00ff00",
    text: "b",
    comment: "",
    tags: [],
    anchor: { pageIndex: 1 },
    sortIndex: "00001|000000|00000",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    syncState: "local",
  };
  await sink.write(
    "proj/papers/y.annotations.json",
    new TextEncoder().encode(typedCore().renderAnnotationsFile([outside as unknown as Record<string, unknown>])),
  );
  const fresh2 = createGroupCWriter(sink, "proj");
  const back = await fresh2.readBack("annotations");
  assert.deepEqual(back.map((r) => r.id).sort(), ["ann-1", "ann-outside"]);
});

test("annotations: createdAt and updatedAt from the row are kept", async () => {
  const { writer } = fresh();
  await writer.write("annotations", {
    id: "ann-ts",
    paperId: "p1",
    paperFile: "proj/papers/x.paper.md",
    type: "highlight",
    color: "#ff0000",
    text: "t",
    comment: "",
    tags: [],
    anchor: { pageIndex: 0 },
    sortIndex: "00000|000000|00000",
    pageIndex: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-02T00:00:00.000Z",
  });
  const [back] = await writer.readBack("annotations");
  assert.equal(back?.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(back?.updatedAt, "2026-02-02T00:00:00.000Z");
});

test("annotationPins: the row id and createdAt are kept", async () => {
  const { writer } = fresh();
  await writer.write("annotationPins", {
    id: "annotation-pin-server-1",
    paperId: "p1",
    annotationKey: "k1",
    reportSectionId: "s1",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const [back] = await writer.readBack("annotationPins");
  assert.equal(back?.id, "annotation-pin-server-1");
  assert.equal(back?.createdAt, "2026-01-01T00:00:00.000Z");
});

test("blobs: readBack scans assets/ on disk, so a blob from an earlier run is listed", async () => {
  const { sink, writer: first } = fresh();
  const bytes = new Uint8Array([10, 20, 30]);
  const sha256 = await sha256Hex(bytes);
  await first.write("blobs", { bucket: "images", path: "old/x.webp", sha256, bytes, contentType: "image/webp" });
  const later = createGroupCWriter(sink, "proj");
  const back = await later.readBack("blobs");
  assert.equal(back.length, 1);
  assert.deepEqual(
    { bucket: back[0]!.bucket, path: back[0]!.path, sha256: back[0]!.sha256, contentType: back[0]!.contentType },
    { bucket: "images", path: "old/x.webp", sha256, contentType: "image/webp" },
  );
});

test("blobs: readBack leaves out an asset whose bytes no longer match its sidecar", async () => {
  const { sink, writer } = fresh();
  const bytes = new Uint8Array([1, 2, 3]);
  await writer.write("blobs", { bucket: "images", path: "t.webp", sha256: await sha256Hex(bytes), bytes });
  await sink.write("assets/images/t.webp", "tampered");
  const later = createGroupCWriter(sink, "proj");
  assert.deepEqual(await later.readBack("blobs"), []);
});

test("blobs: readBack skips a stale .part file and lists nothing for it", async () => {
  const { sink, writer } = fresh();
  const bytes = new Uint8Array([4, 5, 6]);
  await writer.write("blobs", { bucket: "images", path: "ok.webp", sha256: await sha256Hex(bytes), bytes });
  await sink.write("assets/images/ok.webp.part", "half written");
  const back = await createGroupCWriter(sink, "proj").readBack("blobs");
  assert.deepEqual(back.map((r) => r.path), ["ok.webp"]);
});

test("blobs: an asset with no sidecar is left out of read-back and does not fail the others", async () => {
  const { sink, writer } = fresh();
  const bytes = new Uint8Array([7, 8, 9]);
  await writer.write("blobs", { bucket: "images", path: "ok.webp", sha256: await sha256Hex(bytes), bytes });
  await sink.write("assets/images/bare.webp", "no sidecar here");
  const back = await createGroupCWriter(sink, "proj").readBack("blobs");
  assert.deepEqual(back.map((r) => r.path), ["ok.webp"]);
});

test("blobs: a blob whose bytes no longer match its sidecar is left out; the other blobs still read back", async () => {
  const { sink, writer } = fresh();
  const good = new Uint8Array([1, 1, 1]);
  const bad = new Uint8Array([2, 2, 2]);
  await writer.write("blobs", { bucket: "images", path: "good.webp", sha256: await sha256Hex(good), bytes: good });
  await writer.write("blobs", { bucket: "images", path: "bad.webp", sha256: await sha256Hex(bad), bytes: bad });
  await sink.write("assets/images/bad.webp", new Uint8Array([9, 9, 9]));
  const back = await createGroupCWriter(sink, "proj").readBack("blobs");
  assert.deepEqual(back.map((r) => r.path), ["good.webp"]);
});

test("ink: readBack lists the chunks on disk, including one written by an earlier run", async () => {
  const { sink, writer: first } = fresh();
  await sink.write("notes/a.note.md", "---\nweaveforge-id: n1\n---\n");
  await first.write("ink", { note: "n1", chunkId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", bytes: new Uint8Array([1]) });
  const second = createGroupCWriter(sink, "proj");
  await second.write("ink", { note: "n1", chunkId: "01ARZ3NDEKTSV4RRFFQ69G5FAW", bytes: new Uint8Array([2]) });
  const back = await second.readBack("ink");
  assert.deepEqual(back.map((r) => r.chunkId).sort(), ["01ARZ3NDEKTSV4RRFFQ69G5FAV", "01ARZ3NDEKTSV4RRFFQ69G5FAW"]);
});

test("annotations: a row without paperFile throws instead of writing a sidecar at 'undefined'", async () => {
  const { writer } = fresh();
  await assert.rejects(
    writer.write("annotations", {
      id: "a1",
      paperId: "p1",
      type: "highlight",
      color: "yellow",
      text: "t",
      comment: "",
      tags: [],
      anchor: {},
      sortIndex: "0",
      pageIndex: 0,
    }),
    /paperFile/,
  );
});
