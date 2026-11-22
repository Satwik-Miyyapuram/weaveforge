import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { runWebExport, verifyReasonCode } from "../application/run-web-export";
import type { KindWriter } from "../domain/kind-writer";
import type { FileCodec, ServerSource } from "../domain/ports";
import { REPORT_PATH } from "../domain/report";
import { MemorySink } from "../infrastructure/memory-sink";

before(loadTestCore);

test("run: a readBack that differs is listed with the fixed code readback-differs, never the counts", async () => {
  const source = {
    listRows: async () => [{ id: "w1" }],
    listTrashed: async () => [],
    secretCount: async () => 0,
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
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: ["widgets"],
    codec,
    writers: () => [writer],
    now: "2026-11-22T00:00:00.000Z",
    source,
    sink: new MemorySink(),
  });
  const row = result.run.missing.find((m) => m.kind === "widgets");
  assert.deepEqual(row, { kind: "widgets", id: "*", reason: "readback-differs" });
  assert.equal(result.state, "incomplete");
});

test("run: a backup or outbox error message with a path never reaches report.json; the fixed code does", async () => {
  const source = {
    listRows: async () => [],
    listTrashed: async () => [],
    secretCount: async () => 0,
    countRows: async () => 0,
    pendingOutbox: async () => {
      throw new Error("EACCES /secret/path/outbox.json");
    },
    undecryptable: async () => 0,
    listBlobs: async () => [],
    fetchBlob: async () => new Uint8Array(),
    markExported097: async () => {},
  } as unknown as ServerSource;
  const codec = { supports: () => false } as unknown as FileCodec;
  const debug: string[] = [];

  const backupSink = new MemorySink();
  const backedUp = await runWebExport({ runDeviceId: "dev-test",
    kinds: [],
    codec,
    now: "2026-11-22T00:00:00.000Z",
    source,
    sink: backupSink,
    desktop: {
      folder: "C:/ws",
      bridge: {
        backup: async () => {
          throw new Error("EACCES /secret/path/backup.dump");
        },
      },
    },
    debugLog: (line) => debug.push(line),
  });
  const backupReport = await backupSink.readText(REPORT_PATH);
  assert.equal(backedUp.state, "incomplete");
  assert.ok(backupReport.includes("backup-failed"));
  assert.ok(!backupReport.includes("/secret/path"));
  assert.ok(debug.some((l) => l.includes("/secret/path/backup.dump")));

  const outboxSink = new MemorySink();
  const outboxRun = await runWebExport({ runDeviceId: "dev-test",
    kinds: [],
    codec,
    now: "2026-11-22T00:00:00.000Z",
    source,
    sink: outboxSink,
    debugLog: (line) => debug.push(line),
  });
  const outboxReport = await outboxSink.readText(REPORT_PATH);
  assert.equal(outboxRun.state, "incomplete");
  assert.ok(outboxReport.includes("outbox-unreadable"));
  assert.ok(!outboxReport.includes("/secret/path"));
  assert.ok(debug.some((l) => l.includes("/secret/path/outbox.json")));
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
