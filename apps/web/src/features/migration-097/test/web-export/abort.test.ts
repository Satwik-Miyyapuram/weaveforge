import assert from "node:assert/strict";
import { test } from "node:test";
import { readMigrationRuns } from "../../domain/report";
import type { BlobRef, FileCodec } from "../../domain/ports";
import { runWebExport } from "../../application/run-web-export";
import { MemorySink } from "../../infrastructure/memory-sink";
import { NOW, fakeCodec, fakeServer, FIXTURE, KINDS, SUPPORTED, memoryWriter } from "./helpers";

const blob = (path: string): { ref: BlobRef; bytes: Uint8Array } => {
  const bytes = new TextEncoder().encode(path);
  return { ref: { bucket: "ink", path, sizeBytes: bytes.length } as BlobRef, bytes };
};

test("abort: a signal aborted after the first file stops the export before the next file", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const controller = new AbortController();
  const base = fakeCodec(SUPPORTED);
  let files = 0;
  const codec: FileCodec = {
    ...base,
    toFile: (kind, row) => {
      files++;
      controller.abort();
      return base.toFile(kind, row);
    },
  };
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec, source, sink, now: NOW, signal: controller.signal });
  assert.equal(files, 1, "no file after the abort");
  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason === "aborted"));
  assert.ok(!sink.paths().includes("logEntries/l2.json"));
  assert.ok(!calls.includes("list:experiments"), "the next kind is never read");
  assert.ok(!calls.includes("mark:097"), "an aborted run never marks the server");
  // No write after the abort: the early report ("export in progress") is the last word.
  const runs = await readMigrationRuns(sink);
  assert.ok(runs?.every((r) => r.state === "incomplete" && r.missing.some((m) => m.reason === "export in progress")));
});

test("abort: a writer kind stops between rows", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const controller = new AbortController();
  const { writer, stored } = memoryWriter("logEntries");
  const write = writer.write.bind(writer);
  const aborting = { ...writer, write: async (kind: string, row: Parameters<typeof write>[1]) => { await write(kind, row); controller.abort(); } };
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW, writers: () => [aborting], signal: controller.signal });
  assert.equal(stored.length, 1);
  assert.equal(result.state, "incomplete");
  assert.ok(!calls.includes("mark:097"));
});

test("abort: the blob loop stops between blobs", async () => {
  const { source, calls } = fakeServer({ rows: {}, blobs: [blob("a.png"), blob("b.png")] });
  const sink = new MemorySink();
  const controller = new AbortController();
  const fetchBlob = source.fetchBlob.bind(source);
  source.fetchBlob = async (ref) => {
    const bytes = await fetchBlob(ref);
    controller.abort();
    return bytes;
  };
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: [], codec: fakeCodec([]), source, sink, now: NOW, signal: controller.signal });
  assert.deepEqual(calls.filter((c) => c.startsWith("blob:")), ["blob:a.png"]);
  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason === "aborted"));
  assert.ok(!calls.includes("mark:097"));
  // The fetch resolved after the abort: its bytes never land, so a late file cannot overwrite a fresh run's.
  assert.ok(!sink.paths().some((p) => p.includes("a.png")), "a fetch that resolves after the abort writes nothing");
});

test("abort: a hung fetch that resolves long after the abort still writes nothing", async () => {
  const { source } = fakeServer({ rows: {}, blobs: [blob("late.png")] });
  const sink = new MemorySink();
  const controller = new AbortController();
  const fetchBlob = source.fetchBlob.bind(source);
  let release: () => void = () => {};
  source.fetchBlob = async (ref) => {
    const bytes = await fetchBlob(ref);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return bytes;
  };
  const running = runWebExport({ runDeviceId: "dev-test", kinds: [], codec: fakeCodec([]), source, sink, now: NOW, signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  release();
  await running.catch(() => {});
  assert.ok(!sink.paths().some((p) => p.includes("late.png")), "the late bytes never land");
});

test("abort: an already aborted signal reads and writes nothing", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const controller = new AbortController();
  controller.abort();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW, signal: controller.signal });
  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason === "aborted"));
  assert.deepEqual(calls.filter((c) => c.startsWith("list:")), []);
  assert.deepEqual(sink.paths(), []);
});

test("abort: a signal that never aborts changes nothing", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink: new MemorySink(), now: NOW, signal: new AbortController().signal });
  assert.equal(result.state, "verified");
});
