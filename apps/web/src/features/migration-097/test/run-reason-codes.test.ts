import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { runWebExport, verifyReasonCode } from "../application/run-web-export";
import type { KindWriter } from "../domain/kind-writer";
import type { FileCodec, ServerSource } from "../domain/ports";
import { MemorySink } from "../infrastructure/memory-sink";

before(loadTestCore);

test("run: a readBack that differs is listed with the fixed code readback-differs, never the counts", async () => {
  const source = {
    listRows: async () => [{ id: "w1" }],
    listTrashed: async () => [],
    countRows: async () => 1,
    pendingOutbox: async () => 0,
    undecryptable: async () => 0,
    listBlobs: async () => [],
    fetchBlob: async () => new Uint8Array(),
    markExported097: async () => {},
  } as unknown as ServerSource;
  const writer: KindWriter = {
    kinds: ["widgets"],
    write: async () => {},
    readBack: async () => [],
  };
  const codec = { supports: () => false } as unknown as FileCodec;
  const result = await runWebExport({
    kinds: ["widgets"],
    codec,
    writers: [writer],
    now: "2026-11-22T00:00:00.000Z",
    source,
    sink: new MemorySink(),
  });
  const row = result.run.missing.find((m) => m.kind === "widgets");
  assert.deepEqual(row, { kind: "widgets", id: "*", reason: "readback-differs" });
  assert.equal(result.state, "incomplete");
});

test("verifyReasonCode: each verify error maps to a fixed code, with no path or kind text", () => {
  assert.equal(verifyReasonCode("blob secret/p.png: unsafe path"), "blob-unsafe-path");
  assert.equal(verifyReasonCode("blob secret/p.png: size mismatch"), "blob-size-mismatch");
  assert.equal(verifyReasonCode("blob secret/p.png: sha256 mismatch"), "blob-sha256-mismatch");
  assert.equal(verifyReasonCode("blob secret/p.png: read failed"), "read-failed");
  assert.equal(verifyReasonCode("papers: read failed"), "read-failed");
  assert.equal(verifyReasonCode("blobs: read failed"), "read-failed");
  assert.equal(verifyReasonCode("papers: decoded files differ from the rows"), "decoded-differ");
  assert.equal(verifyReasonCode("something new that nobody mapped"), "verify-error");
  for (const raw of ["blob secret/p.png: unsafe path", "papers: decoded files differ from the rows"]) {
    assert.ok(!verifyReasonCode(raw).includes("secret"));
    assert.ok(!verifyReasonCode(raw).includes("papers"));
  }
});
