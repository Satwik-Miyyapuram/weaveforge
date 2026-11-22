import assert from "node:assert/strict";
import { test } from "node:test";
import { REPORT_PATH } from "../../domain/report";
import { SERVER_ONLY_FIELDS } from "../../domain/server-only-fields";
import type { BlobRef, FileCodec, Row } from "../../domain/ports";
import { runWebExport } from "../../application/run-web-export";
import { verifyExport } from "../../application/verify-export";
import { MemorySink } from "../../infrastructure/memory-sink";
import { unzipFiles, zipFiles } from "../../infrastructure/zip";
import { listAllPages } from "../../infrastructure/paging";
import { buildDownloadZip } from "../../application/download-export";
import { NOW, sha, fakeCodec, fakeServer, FIXTURE, KINDS, SUPPORTED, secretProvidersFor, BLOB_WRITER, codecDropping } from "./helpers";

test("fixture export writes every row, verifies field-equal and sets the marker", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
  });

  assert.equal(result.state, "verified");
  assert.equal(result.run.kinds.logEntries?.db, 2);
  assert.equal(result.run.kinds.logEntries?.files, 2);
  assert.equal(result.run.kinds.experiments?.written, 1);

  // Field-equal: decode every exported file back and compare with the server rows.
  const codec = fakeCodec(SUPPORTED);
  for (const kind of KINDS) {
    const decoded: Row[] = [];
    for (const path of await sink.list()) {
      const row = codec.toRow(kind, path, await sink.readText(path));
      if (row) decoded.push(row);
    }
    assert.deepEqual(decoded, FIXTURE[kind]);
  }

  const report = JSON.parse(await sink.readText(REPORT_PATH));
  assert.equal(report.version, 1);
  assert.equal(report.state, "verified");

  assert.deepEqual(
    calls.filter((c) => c.startsWith("mark:")),
    ["mark:097"],
  );
});

test("zip round-trip keeps every exported file byte-equal", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });

  const zip = await zipFiles(sink);
  const back = unzipFiles(zip);

  const paths = await sink.list();
  assert.deepEqual([...back.keys()].sort(), [...paths].sort());
  for (const path of paths) {
    assert.deepEqual(back.get(path), await sink.readBytes(path), path);
  }
});


test("keys: a Zotero-only user's export verifies, with reconnectProviders = [\"zotero\"], and sets the marker", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE, secretProviders: secretProvidersFor({ user_settings: 1 }) });
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: ["logEntries"], codec: fakeCodec(SUPPORTED), source, sink: new MemorySink(), now: NOW });
  assert.equal(result.state, "verified");
  assert.deepEqual(result.reconnectProviders, ["zotero"]);
  assert.equal(calls.includes("mark:097"), true);
});

test("keys: an Overleaf-linked user's export verifies, with reconnectProviders = [\"overleaf\"], and sets the marker", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE, secretProviders: secretProvidersFor({ overleaf_connections: 1 }) });
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: ["logEntries"], codec: fakeCodec(SUPPORTED), source, sink: new MemorySink(), now: NOW });
  assert.equal(result.state, "verified");
  assert.deepEqual(result.reconnectProviders, ["overleaf"]);
  assert.equal(calls.includes("mark:097"), true);
});

test("interrupted run gives incomplete, writes the report and never sets the marker", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE, failKind: "experiments" });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
  });

  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.length > 0);
  assert.ok(JSON.stringify(result.run).includes("experiments: read failed"));
  assert.equal(JSON.stringify(result.run).includes("connection reset"), false);
  const report = JSON.parse(await sink.readText(REPORT_PATH));
  assert.equal(report.state, "incomplete");
  assert.equal(calls.some((c) => c.startsWith("mark:")), false);
});

test("a kind without a wasm codec stays incomplete and is listed as missing", async () => {
  const rows = { ...FIXTURE, tags: [{ id: "t1", name: "ml" }] };
  const { source, calls } = fakeServer({ rows });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: [...KINDS, "tags"],
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
  });

  assert.equal(result.state, "incomplete");
  assert.equal(result.run.kinds.tags?.db, 1);
  assert.equal(result.run.kinds.tags?.files, 0);
  assert.deepEqual(result.run.missing, [
    { kind: "tags", id: "t1", reason: "no wf-wasm codec" },
  ]);
  assert.equal(calls.some((c) => c.startsWith("mark:")), false);
});

test("blob: size matches and the local sha256 verifies, sidecar written", async () => {
  const bytes = new TextEncoder().encode("png-bytes");
  const ref: BlobRef = { bucket: "notes-assets", path: "fig/a.png", sizeBytes: bytes.length };
  const { source } = fakeServer({ rows: {}, blobs: [{ ref, bytes }] });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: [], codec: fakeCodec([]), source, sink, now: NOW });

  assert.equal(result.state, "verified");
  assert.deepEqual(result.run.blobs, { db: 1, verified: 1 });
  assert.deepEqual(result.run.missing, []);
  assert.deepEqual(await sink.readBytes("assets/notes-assets/fig/a.png"), bytes);
  assert.equal(await sink.readText("assets/notes-assets/fig/a.png.sha256"), sha(bytes));
});

test("blob: an unsafe path (.. or a sidecar name) is listed missing as unsafe path, never fetched or written", async () => {
  const bytes = new TextEncoder().encode("x");
  const escape: BlobRef = { bucket: "notes-assets", path: "../escape.png", sizeBytes: bytes.length };
  const sidecar: BlobRef = { bucket: "notes-assets", path: "fig/a.png.sha256", sizeBytes: bytes.length };
  const { source, calls } = fakeServer({
    rows: {},
    blobs: [
      { ref: escape, bytes },
      { ref: sidecar, bytes },
    ],
  });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: [], codec: fakeCodec([]), source, sink, now: NOW });

  assert.equal(result.state, "incomplete");
  assert.deepEqual(result.run.missing.filter((m) => m.kind === "blobs"), [
    { kind: "blobs", id: "notes-assets/../escape.png", reason: "unsafe path" },
    { kind: "blobs", id: "notes-assets/fig/a.png.sha256", reason: "unsafe path" },
  ]);
  assert.equal(calls.some((c) => c.startsWith("blob:")), false);
  assert.equal((await sink.list()).some((p) => p.startsWith("assets/")), false);
});

test("blob size mismatch goes to missing, nothing is written, no marker", async () => {
  const bytes = new TextEncoder().encode("8 bytes!");
  const ref: BlobRef = { bucket: "notes-assets", path: "fig/a.png", sizeBytes: 99 };
  const { source, calls } = fakeServer({ rows: {}, blobs: [{ ref, bytes }] });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: [], codec: fakeCodec([]), source, sink, now: NOW });

  assert.equal(result.state, "incomplete");
  assert.deepEqual(result.run.blobs, { db: 1, verified: 0 });
  assert.deepEqual(result.run.missing.filter((m) => m.kind === "blobs"), [
    { kind: "blobs", id: "notes-assets/fig/a.png", reason: "size mismatch on fetch" },
  ]);
  await assert.rejects(() => sink.readBytes("assets/notes-assets/fig/a.png"));
  assert.equal(calls.some((c) => c.startsWith("mark:")), false);
});

test("blob read-back mismatch goes to missing (same size, different bytes), no marker", async () => {
  class TamperingSink extends MemorySink {
    override async readBytes(path: string): Promise<Uint8Array> {
      const real = await super.readBytes(path);
      return path.startsWith("assets/") ? new TextEncoder().encode("X".repeat(real.length)) : real;
    }
  }
  const bytes = new TextEncoder().encode("png-bytes");
  const ref: BlobRef = { bucket: "notes-assets", path: "fig/a.png", sizeBytes: bytes.length };
  const { source, calls } = fakeServer({ rows: {}, blobs: [{ ref, bytes }] });
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: [], codec: fakeCodec([]), source, sink: new TamperingSink(), now: NOW,
  });

  assert.equal(result.state, "incomplete");
  assert.deepEqual(result.run.missing.filter((m) => m.kind === "blobs"), [
    { kind: "blobs", id: "notes-assets/fig/a.png", reason: "read-back sha256 mismatch" },
  ]);
  assert.equal(calls.some((c) => c.startsWith("mark:")), false);
});

test("verify is strict: a file missing from the sink makes state incomplete", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });

  const damaged = new MemorySink();
  for (const path of await sink.list()) {
    if (path !== "experiments/e1.json") await damaged.write(path, await sink.readBytes(path));
  }
  const verdict = await verifyExport({
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink: damaged,
  });
  assert.equal(verdict.state, "incomplete");
  assert.equal(verdict.kinds.experiments?.files, 0);
});

test("raw server count above the exported rows gives incomplete (short source list)", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE, rawCounts: { logEntries: 3 } });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });

  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.kind === "logEntries" && m.reason.includes("raw count")));
  assert.equal(calls.some((c) => c.startsWith("mark:")), false);
});

test("undecryptable content_enc rows keep the export incomplete and name kind and count", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE, undecryptable: { logEntries: 2 } });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });

  assert.equal(result.state, "incomplete");
  assert.ok(
    result.run.missing.some((m) => m.kind === "logEntries" && m.reason.includes("2") && /decrypt/.test(m.reason)),
  );
  assert.equal(calls.some((c) => c.startsWith("mark:")), false);
});


test("blobs with a writer still check the raw count against blob_objects", async () => {
  const { source } = fakeServer({ rows: {}, rawCounts: { blobs: 5 } });
  const result = await runWebExport({
    runDeviceId: "dev-test",
    kinds: ["blobs"],
    codec: fakeCodec(SUPPORTED),
    source,
    sink: new MemorySink(),
    now: NOW,
    writers: () => [BLOB_WRITER],
  });
  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.kind === "blobs" && /raw count 5 != listed 0/.test(m.reason)));
});

test("blobs with a writer still check undecryptable rows", async () => {
  const { source } = fakeServer({ rows: {}, undecryptable: { blobs: 2 } });
  const result = await runWebExport({
    runDeviceId: "dev-test",
    kinds: ["blobs"],
    codec: fakeCodec(SUPPORTED),
    source,
    sink: new MemorySink(),
    now: NOW,
    writers: () => [BLOB_WRITER],
  });
  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.kind === "blobs" && /2 content_enc row/.test(m.reason)));
});

test("report has verifiedAt when verified, no runs errors field, and is written atomically", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const events: { kind: string; done: number; total: number }[] = [];
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    onProgress: (e) => events.push(e),
  });

  assert.equal(result.state, "verified");
  const report = JSON.parse(await sink.readText(REPORT_PATH));
  assert.equal(typeof report.verifiedAt, "string");
  assert.equal("errors" in report.runs[0], false);
  assert.deepEqual(
    (await sink.list()).filter((p) => p.endsWith(".part")),
    [],
  );
  assert.deepEqual(events.at(-1), { kind: "experiments", done: 1, total: 1 });
});

test("pending outbox refuses the export: state incomplete, only the report written, no marker", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE, outbox: 2 });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });

  assert.equal(result.state, "incomplete");
  assert.deepEqual(await sink.list(), [REPORT_PATH]);
  assert.equal(calls.some((c) => c.startsWith("list:") || c.startsWith("mark:")), false);
});

test("listAllPages reads past the 1000-row PostgREST cap until an empty page", async () => {
  const total = Array.from({ length: 2500 }, (_, i) => i);
  const fetchPage = async (offset: number, limit: number) =>
    total.slice(offset, offset + Math.min(limit, 1000));
  const all = await listAllPages(fetchPage);
  assert.equal(all.length, 2500);
  assert.deepEqual(all, total);
});

test("download-your-data zip is built from the sink only, never marks the server, and keeps an incomplete report", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE, failKind: "experiments" });
  const sink = new MemorySink();
  await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  const callsBefore = calls.length;

  const zip = await buildDownloadZip(sink);
  const back = unzipFiles(zip);

  assert.ok(back.has(REPORT_PATH));
  assert.equal(JSON.parse(new TextDecoder().decode(back.get(REPORT_PATH))).state, "incomplete");
  assert.equal(calls.length, callsBefore);
  assert.equal(calls.some((c) => c.startsWith("mark:")), false);
});


test("verify allow-list: a server-only column (userId) absent from the file still verifies", async () => {
  const rows = { experiments: [{ id: "e9", name: "Z", userId: "u-1" }] };
  const { source } = fakeServer({ rows });
  const codec = codecDropping(["experiments"], ["userId"]);
  const sink = new MemorySink();
  await runWebExport({ runDeviceId: "dev-test", kinds: ["experiments"], codec, source, sink, now: NOW });
  const verdict = await verifyExport({ kinds: ["experiments"], codec, source, sink });
  assert.equal(verdict.state, "verified");
});

test("verify allow-list: an unlisted server column the file lacks is a mismatch", async () => {
  const rows = { experiments: [{ id: "e9", name: "Z", secretOther: "x" }] };
  const { source } = fakeServer({ rows });
  const codec = codecDropping(["experiments"], ["secretOther"]);
  const sink = new MemorySink();
  await runWebExport({ runDeviceId: "dev-test", kinds: ["experiments"], codec, source, sink, now: NOW });
  const verdict = await verifyExport({ kinds: ["experiments"], codec, source, sink });
  assert.equal(verdict.state, "incomplete");
  assert.ok(verdict.errors.some((e) => e.startsWith("experiments: decoded files differ")));
});

test("verify allow-list: the owner column arrives camelCased (projectId) and absent from the file still verifies", async () => {
  // The PostgREST source camelCases every key, so the owner column is `projectId`, never `project_id`.
  const rows = { experiments: [{ id: "e9", name: "Z", projectId: "p-1" }] };
  const { source } = fakeServer({ rows });
  const codec = codecDropping(["experiments"], ["projectId"]);
  const sink = new MemorySink();
  await runWebExport({ runDeviceId: "dev-test", kinds: ["experiments"], codec, source, sink, now: NOW });
  const verdict = await verifyExport({ kinds: ["experiments"], codec, source, sink });
  assert.equal(verdict.state, "verified");
});

test("allow-list: every entry is camelCase, as toCamelRow produces", () => {
  for (const [kind, columns] of Object.entries(SERVER_ONLY_FIELDS)) {
    for (const column of columns) assert.doesNotMatch(column, /_/, `${kind}: ${column} is snake_case`);
  }
});

test("per-row failure: one bad row is listed missing, the other rows are exported, the report is incomplete, no marker", async () => {
  const rows = { experiments: [{ id: "e1", name: "A" }, { id: "bad", name: "B" }, { id: "e2", name: "C" }] };
  const { source, calls } = fakeServer({ rows });
  const base = fakeCodec(["experiments"]);
  const codec: FileCodec = {
    ...base,
    toFile: (kind, row) => {
      if (row.id === "bad") throw new Error("cannot encode");
      return base.toFile(kind, row);
    },
  };
  const sink = new MemorySink();
  const { state, run } = await runWebExport({ runDeviceId: "dev-test", kinds: ["experiments"], codec, source, sink, now: NOW });
  assert.equal(state, "incomplete");
  assert.ok(run.missing.some((m) => m.kind === "experiments" && m.id === "bad" && m.reason === "codec-failed:experiments"));
  assert.equal(run.kinds.experiments?.written, 2);
  assert.ok(await sink.readText("experiments/e1.json").then(() => true, () => false));
  assert.ok(await sink.readText("experiments/e2.json").then(() => true, () => false));
  assert.equal(calls.some((c) => c.startsWith("mark:")), false);
});
