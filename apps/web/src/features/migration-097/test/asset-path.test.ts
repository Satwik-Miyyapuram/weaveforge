import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { sanitizeBlobRefs } from "../domain/asset-path";
import type { BlobRef, FileCodec, ServerSource } from "../domain/ports";
import { sha256Hex } from "../domain/hash";
import { runWebExport } from "../application/run-web-export";
import { MemorySink } from "../infrastructure/memory-sink";

before(loadTestCore);

const ref = (bucket: string, path: string, sizeBytes = 1): BlobRef => ({ bucket, path, sizeBytes });
const paths = (refs: BlobRef[]) => sanitizeBlobRefs(refs).map((r) => `${r.bucket}/${r.path}${r.unsafe ? " (unsafe)" : ""}`);

test("blob paths: a dotted name is safe when no segment is '..' (a..b is allowed)", () => {
  assert.deepEqual(paths([ref("bkt", "a..b.png")]), ["bkt/a..b.png"]);
});

test("blob paths: a '..' or '.' segment is unsafe", () => {
  assert.deepEqual(paths([ref("bkt", "x/../y.png"), ref("bkt", "./y.png")]), ["bkt/./y.png (unsafe)", "bkt/x/../y.png (unsafe)"]);
});

test("blob paths: an empty segment, a leading slash, a backslash or a .sha256 name is unsafe", () => {
  assert.deepEqual(
    paths([ref("bkt", "/abs.png"), ref("bkt", "a//b.png"), ref("bkt", "a\\b.png"), ref("bkt", "x.sha256")]),
    ["bkt//abs.png (unsafe)", "bkt/a//b.png (unsafe)", "bkt/a\\b.png (unsafe)", "bkt/x.sha256 (unsafe)"],
  );
});

test("blob paths: ':' and NUL become '_' in each segment", () => {
  assert.deepEqual(paths([ref("bkt", "a:b.png"), ref("bk:t", "c\u0000d.png")]), ["bk_t/c_d.png", "bkt/a_b.png"]);
});

test("blob paths: a trailing dot or space is replaced in each segment", () => {
  assert.deepEqual(paths([ref("bkt", "name. "), ref("bkt", "dir./file.txt")]), ["bkt/dir_/file.txt", "bkt/name__"]);
});

test("blob paths: a Windows reserved device name gets a leading '_' (also with an extension)", () => {
  assert.deepEqual(
    paths([ref("bkt", "CON.txt"), ref("bkt", "dir/com1"), ref("bkt", "lpt9.png"), ref("bkt", "nul")]),
    ["bkt/_CON.txt", "bkt/dir/_com1", "bkt/_lpt9.png", "bkt/_nul"],
  );
});

test("blob paths: names that collide case-insensitively get a stable numbered suffix before the extension", () => {
  assert.deepEqual(paths([ref("bkt", "a.png"), ref("bkt", "A.png")]), ["bkt/A.png", "bkt/a-2.png"]);
});

test("blob paths: the sanitized names do not depend on the order the server lists the blobs in", () => {
  const refs = [ref("bkt", "a.png"), ref("bkt", "A.png"), ref("bkt", "a:b.png")];
  assert.deepEqual(paths([...refs].reverse()).sort(), paths(refs).sort());
  assert.deepEqual(sanitizeBlobRefs([...refs].reverse()).map((r) => r.path).sort(), ["A.png", "a-2.png", "a_b.png"]);
});

test("blob paths: runWebExport writes the sanitized names, and verifies them with no missing entries", async () => {
  const bytesA = new Uint8Array([1, 2, 3]);
  const bytesB = new Uint8Array([4, 5]);
  const refs = [ref("bkt", "a..b.png", bytesA.length), ref("bkt", "c:d.png", bytesB.length)];
  const source = {
    listRows: async () => [],
    listTrashed: async () => [],
    countRows: async () => 0,
    pendingOutbox: async () => 0,
    undecryptable: async () => 0,
    listBlobs: async () => refs,
    fetchBlob: async (r: BlobRef) => (r.path === "a..b.png" ? bytesA : bytesB),
    markExported097: async () => {},
  } as unknown as ServerSource;
  const codec = { supports: () => false } as unknown as FileCodec;
  const sink = new MemorySink();
  const result = await runWebExport({ kinds: [], codec, now: "2026-11-22T00:00:00.000Z", source, sink });
  assert.deepEqual(result.run.missing, []);
  assert.equal(result.state, "verified");
  assert.equal(await sha256Hex(await sink.readBytes("assets/bkt/a..b.png")), await sha256Hex(bytesA));
  assert.equal(await sha256Hex(await sink.readBytes("assets/bkt/c_d.png")), await sha256Hex(bytesB));
});
