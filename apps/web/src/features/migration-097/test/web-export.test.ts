import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { REPORT_PATH } from "../domain/report";
import type { BlobRef, FileCodec, Row, ServerSource } from "../domain/ports";
import { runWebExport } from "../application/run-web-export";
import { verifyExport } from "../application/verify-export";
import { MemorySink } from "../infrastructure/memory-sink";
import { unzipFiles, zipFiles } from "../infrastructure/zip";
import { listAllPages } from "../infrastructure/paging";

const NOW = "2026-11-22T00:00:00.000Z";
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

// Fake codec: one JSON file per row at <kind>/<id>.json. Only `supported` kinds have a codec.
function fakeCodec(supported: string[]): FileCodec {
  return {
    supports: (kind) => supported.includes(kind),
    toFile: (kind, row) => ({ path: `${kind}/${String(row.id)}.json`, text: JSON.stringify(row) }),
    toRow: (kind, path, text) => (path.startsWith(`${kind}/`) ? (JSON.parse(text) as Row) : null),
  };
}

// Fake PostgREST: rows per kind and blobs. `failKind` throws on list, simulating an interrupted run.
function fakeServer(opts: {
  rows: Record<string, Row[]>;
  blobs?: { ref: BlobRef; bytes: Uint8Array }[];
  failKind?: string;
  rawCounts?: Record<string, number>;
  outbox?: number;
  undecryptable?: Record<string, number>;
}) {
  const calls: string[] = [];
  const source: ServerSource = {
    listRows: async (kind) => {
      calls.push(`list:${kind}`);
      if (kind === opts.failKind) throw new Error("connection reset");
      return opts.rows[kind] ?? [];
    },
    countRows: async (kind) => {
      calls.push(`count:${kind}`);
      return opts.rawCounts?.[kind] ?? (opts.rows[kind] ?? []).length;
    },
    pendingOutbox: async () => opts.outbox ?? 0,
    undecryptable: async (kind) => opts.undecryptable?.[kind] ?? 0,
    listBlobs: async () => (opts.blobs ?? []).map((b) => b.ref),
    fetchBlob: async (ref) => {
      calls.push(`blob:${ref.path}`);
      const hit = (opts.blobs ?? []).find((b) => b.ref.path === ref.path);
      if (!hit) throw new Error("no such blob");
      return hit.bytes;
    },
    markExported: async (at) => {
      calls.push(`mark:${at}`);
    },
  };
  return { source, calls };
}

const FIXTURE: Record<string, Row[]> = {
  logEntries: [
    { id: "l1", text: "first" },
    { id: "l2", text: "second  " },
  ],
  experiments: [{ id: "e1", name: "Exp", n: 3, tags: ["x"] }],
};
const KINDS = ["logEntries", "experiments"];
const SUPPORTED = ["logEntries", "experiments"];

test("fixture export writes every row, verifies field-equal and sets the marker", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const result = await runWebExport({
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
    [`mark:${NOW}`],
  );
});

test("zip round-trip keeps every exported file byte-equal", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  await runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });

  const zip = await zipFiles(sink);
  const back = unzipFiles(zip);

  const paths = await sink.list();
  assert.deepEqual([...back.keys()].sort(), [...paths].sort());
  for (const path of paths) {
    assert.deepEqual(back.get(path), await sink.readBytes(path), path);
  }
});

test("interrupted run gives incomplete, writes the report and never sets the marker", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE, failKind: "experiments" });
  const sink = new MemorySink();
  const result = await runWebExport({
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
  });

  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.length > 0 || result.run.errors?.length);
  assert.ok(JSON.stringify(result.run).includes("connection reset"));
  const report = JSON.parse(await sink.readText(REPORT_PATH));
  assert.equal(report.state, "incomplete");
  assert.equal(calls.some((c) => c.startsWith("mark:")), false);
});

test("a kind without a wasm codec stays incomplete and is listed as missing", async () => {
  const rows = { ...FIXTURE, tags: [{ id: "t1", name: "ml" }] };
  const { source, calls } = fakeServer({ rows });
  const sink = new MemorySink();
  const result = await runWebExport({
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

test("blob with matching sha256 verifies and writes its sidecar", async () => {
  const bytes = new TextEncoder().encode("png-bytes");
  const ref: BlobRef = { bucket: "notes-assets", path: "fig/a.png", sha256: sha(bytes) };
  const { source } = fakeServer({ rows: {}, blobs: [{ ref, bytes }] });
  const sink = new MemorySink();
  const result = await runWebExport({ kinds: [], codec: fakeCodec([]), source, sink, now: NOW });

  assert.equal(result.state, "verified");
  assert.deepEqual(result.run.blobs, { db: 1, verified: 1 });
  assert.deepEqual(await sink.readBytes("assets/notes-assets/fig/a.png"), bytes);
  assert.equal(await sink.readText("assets/notes-assets/fig/a.png.sha256"), sha(bytes));
});

test("blob sha256 mismatch gives incomplete and no marker", async () => {
  const ref: BlobRef = { bucket: "notes-assets", path: "fig/a.png", sha256: sha("expected") };
  const { source, calls } = fakeServer({
    rows: {},
    blobs: [{ ref, bytes: new TextEncoder().encode("tampered") }],
  });
  const sink = new MemorySink();
  const result = await runWebExport({ kinds: [], codec: fakeCodec([]), source, sink, now: NOW });

  assert.equal(result.state, "incomplete");
  assert.deepEqual(result.run.blobs, { db: 1, verified: 0 });
  assert.equal(calls.some((c) => c.startsWith("mark:")), false);
});

test("verify is strict: a file missing from the sink makes state incomplete", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  await runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });

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
  const result = await runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });

  assert.equal(result.state, "incomplete");
  assert.ok(result.run.errors.some((e) => e.includes("raw count")));
  assert.equal(calls.some((c) => c.startsWith("mark:")), false);
});

test("undecryptable content_enc rows keep the export incomplete and name kind and count", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE, undecryptable: { logEntries: 2 } });
  const sink = new MemorySink();
  const result = await runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });

  assert.equal(result.state, "incomplete");
  assert.ok(
    result.run.missing.some((m) => m.kind === "logEntries" && m.reason.includes("2") && /decrypt/.test(m.reason)),
  );
  assert.equal(calls.some((c) => c.startsWith("mark:")), false);
});

test("pending outbox refuses the export: state none, nothing written, no marker", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE, outbox: 2 });
  const sink = new MemorySink();
  const result = await runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });

  assert.equal(result.state, "none");
  assert.deepEqual(await sink.list(), []);
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
