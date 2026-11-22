import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { REPORT_PATH, readMigrationReport, unverifiedDevices, writesOff, type RunReport } from "../domain/report";
import { SERVER_ONLY_FIELDS } from "../domain/server-only-fields";
import type { BlobRef, FileCodec, Row, ServerSource } from "../domain/ports";
import type { KindWriter } from "../domain/kind-writer";
import { runWebExport } from "../application/run-web-export";
import { createSecretMover } from "../application/move-secrets";
import { sameRows, verifyExport } from "../application/verify-export";
import { MemorySink } from "../infrastructure/memory-sink";
import { unzipFiles, zipFiles } from "../infrastructure/zip";
import { listAllPages } from "../infrastructure/paging";
import { buildDownloadZip } from "../application/download-export";

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
  trashed?: Record<string, Row[]>;
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
    listTrashed: async (kind) => {
      calls.push(`trash:${kind}`);
      return opts.trashed?.[kind] ?? [];
    },
    undecryptable: async (kind) => opts.undecryptable?.[kind] ?? 0,
    listBlobs: async () => (opts.blobs ?? []).map((b) => b.ref),
    fetchBlob: async (ref) => {
      calls.push(`blob:${ref.path}`);
      const hit = (opts.blobs ?? []).find((b) => b.ref.path === ref.path);
      if (!hit) throw new Error("no such blob");
      return hit.bytes;
    },
    markExported097: async () => {
      calls.push("mark:097");
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

/** Codec that writes every column except `dropped`, as a file that lacks server-only columns would. */
function codecDropping(kinds: string[], dropped: string[]): FileCodec {
  const base = fakeCodec(kinds);
  return {
    ...base,
    toFile: (kind, row) => ({
      path: `${kind}/${String(row.id)}.json`,
      text: JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => !dropped.includes(k)))),
    }),
  };
}

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

// Desktop contract: backup before any export read or write; mark-exported only when verified.
function fakeDesktop(calls: string[], opts: { backupFails?: boolean; deviceId?: string; markFails?: boolean; dump?: string } = {}) {
  return {
    backup: async (folder: string) => {
      calls.push(`backup:${folder}`);
      if (opts.backupFails) throw new Error("disk full writing pre-migration.dump");
      return { deviceId: opts.deviceId ?? "dev-42", dump: opts.dump ?? "pre-migration-097.dump" };
    },
    markExported: async (folder: string) => {
      calls.push(`desktop-mark:${folder}`);
      if (opts.markFails) throw new Error("shell refused");
    },
  };
}

test("desktop: backup runs first, before any server read, and the report carries its deviceId", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    desktop: { folder: "C:/ws", bridge: fakeDesktop(calls, { deviceId: "dev-42" }) },
  });

  assert.equal(result.state, "verified");
  assert.equal(calls[0], "backup:C:/ws");
  const firstRead = calls.findIndex((c) => c.startsWith("list:") || c.startsWith("count:"));
  assert.ok(firstRead > 0, "server read happens after backup");
  const report = JSON.parse(await sink.readText(REPORT_PATH)) as { deviceId?: string };
  assert.equal(report.deviceId, "dev-42");
});

test("desktop: report.backup carries the backup dump file name", async () => {
  const sink = new MemorySink();
  const { source } = fakeServer({ rows: FIXTURE });
  await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    desktop: { folder: "C:/ws", bridge: fakeDesktop([], { dump: "pre-migration-097-20261122.dump" }) },
  });
  const report = JSON.parse(await sink.readText(REPORT_PATH));
  assert.equal(report.backup, "pre-migration-097-20261122.dump");
});

test("desktop: a bridge without migrate097Backup refuses before any server read or write", async () => {
  const sink = new MemorySink();
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    desktop: { folder: "C:/ws", bridge: { markExported: async () => {} } as never },
  });
  assert.notEqual(result.state, "verified");
  assert.match(result.run.missing[0]!.reason, /migrate097Backup missing/);
  assert.deepEqual(calls, []);
  assert.deepEqual(await sink.list(), [REPORT_PATH]);
});

test("desktop: a failed backup aborts the export: no server read, no write, no marker, no mark-exported", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    desktop: { folder: "C:/ws", bridge: fakeDesktop(calls, { backupFails: true }) },
  });

  assert.equal(result.state, "incomplete");
  assert.equal(result.run.missing[0]!.reason, "backup-failed");
  assert.deepEqual(calls, ["backup:C:/ws"]);
  assert.deepEqual(await sink.list(), [REPORT_PATH]);
});

test("desktop: mark-exported runs only after a verified run", async () => {
  const calls: string[] = [];
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    desktop: { folder: "C:/ws", bridge: fakeDesktop(calls) },
  });
  assert.equal(result.state, "verified");
  assert.equal(calls.at(-1), "desktop-mark:C:/ws");
});

test("desktop: an incomplete run does not call mark-exported", async () => {
  const calls: string[] = [];
  const { source } = fakeServer({ rows: FIXTURE, failKind: "logEntries" });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    desktop: { folder: "C:/ws", bridge: fakeDesktop(calls) },
  });
  assert.equal(result.state, "incomplete");
  assert.equal(calls.some((c) => c.startsWith("desktop-mark")), false);
});

test("web: no desktop bridge still records a deviceId in report.json (a fresh one when none is given)", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  const report = JSON.parse(await sink.readText(REPORT_PATH)) as { deviceId?: unknown; runs: RunReport[] };
  assert.equal(typeof report.deviceId, "string");
  assert.equal(report.runs[0]?.deviceId, report.deviceId);
});

test("verify: a null server contentType and application/octet-stream in the file are the same blob type", async () => {
  // Group c writes null as octet-stream, so verify must accept that pair as equal.
  const codec: FileCodec = {
    supports: (kind) => kind === "blobs",
    toFile: (kind, row) => ({
      path: `${kind}/${String(row.id)}.json`,
      text: JSON.stringify({ ...row, contentType: row.contentType ?? "application/octet-stream" }),
    }),
    toRow: (kind, path, text) => (path.startsWith(`${kind}/`) ? (JSON.parse(text) as Row) : null),
  };
  const { source } = fakeServer({ rows: { blobs: [{ id: "b1", contentType: null, bucket: "x" }] } });
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: ["blobs"], codec, source, sink: new MemorySink(), now: NOW });
  assert.equal(result.state, "verified");
});

test("order: the server marker comes first, the desktop mark last, and report.json says incomplete until both succeed", async () => {
  const order: string[] = [];
  const sink = new MemorySink();
  const { source } = fakeServer({ rows: FIXTURE });
  const realMark = source.markExported097;
  source.markExported097 = async () => {
    order.push("server-mark");
    await realMark();
  };
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    desktop: {
      folder: "C:/ws",
      bridge: {
        backup: async () => ({ deviceId: "dev-1", dump: "pre-migration-097.dump" }),
        markExported: async () => {
          const report = JSON.parse(await sink.readText(REPORT_PATH)) as { state: string };
          order.push(`desktop-mark:report=${report.state}`);
        },
      },
    },
  });
  assert.equal(result.state, "verified");
  assert.deepEqual(order, ["server-mark", "desktop-mark:report=incomplete"]);
  const final = JSON.parse(await sink.readText(REPORT_PATH)) as { state: string };
  assert.equal(final.state, "verified");
});

test("order: a failed desktop mark (last) leaves report.json incomplete, though the server marker is already set", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const desktopCalls: string[] = [];
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    desktop: { folder: "C:/ws", bridge: fakeDesktop(desktopCalls, { markFails: true }) },
  });
  assert.equal(result.state, "incomplete");
  assert.equal(calls.some((c) => c.startsWith("mark:")), true, "server marker set first");
  const report = JSON.parse(await sink.readText(REPORT_PATH)) as { state: string; verifiedAt?: string };
  assert.equal(report.state, "incomplete");
  assert.equal("verifiedAt" in report, false);
  assert.match(JSON.stringify(report), /marker: desktop failed/);
});

test("order: a failed server marker leaves report.json incomplete and the desktop is not marked", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  source.markExported097 = async () => {
    throw new Error("server down");
  };
  const sink = new MemorySink();
  const desktopCalls: string[] = [];
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    desktop: { folder: "C:/ws", bridge: fakeDesktop(desktopCalls) },
  });
  assert.equal(result.state, "incomplete");
  assert.equal(desktopCalls.some((c) => c.startsWith("desktop-mark")), false, "no desktop mark");
  const report = JSON.parse(await sink.readText(REPORT_PATH)) as { state: string };
  assert.equal(report.state, "incomplete");
  assert.match(JSON.stringify(report), /marker: server failed/);
});

test("order: a crash between the two marks never leaves report.json verified", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    desktop: {
      folder: "C:/ws",
      bridge: {
        backup: async () => ({ deviceId: "dev-1", dump: "pre-migration-097.dump" }),
        markExported: async () => {
          throw new Error("process died");
        },
      },
    },
  });
  assert.equal(calls.some((c) => c.startsWith("mark:")), true, "server marker was set before the crash");
  assert.notEqual(result.state, "verified");
  const report = JSON.parse(await sink.readText(REPORT_PATH)) as { state: string; verifiedAt?: string };
  assert.equal(report.state, "incomplete");
  assert.equal("verifiedAt" in report, false);
});

test("order: report.json says markers pending before any mark is attempted", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const seen: string[] = [];
  source.markExported097 = async () => {
    const report = JSON.parse(await sink.readText(REPORT_PATH)) as {
      state: string;
      runs: { missing: { reason: string }[] }[];
    };
    seen.push(report.state + ":" + JSON.stringify(report.runs[0]?.missing ?? []));
  };
  await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  assert.equal(seen.length, 1);
  assert.match(seen[0] ?? "", /^incomplete:.*markers pending/);
});

test("order: a failed report.json write means no desktop mark and no server marker", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const realRename = sink.rename.bind(sink);
  sink.rename = async (from: string, to: string) => {
    if (to === REPORT_PATH) throw new Error("disk full writing report");
    return realRename(from, to);
  };
  const desktopCalls: string[] = [];
  await assert.rejects(
    runWebExport({ runDeviceId: "dev-test",
      kinds: KINDS,
      codec: fakeCodec(SUPPORTED),
      source,
      sink,
      now: NOW,
      desktop: { folder: "C:/ws", bridge: fakeDesktop(desktopCalls) },
    }),
    /disk full writing report/,
  );
  assert.deepEqual(desktopCalls, ["backup:C:/ws"]);
  assert.equal(calls.some((c) => c.startsWith("mark:")), false, "server marker not set");
});

test("interrupted run: report.json says incomplete before the first row is written", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const realWrite = sink.write.bind(sink);
  let reportAtFirstRow: string | null | undefined;
  sink.write = async (path: string, data: string | Uint8Array) => {
    if (reportAtFirstRow === undefined && path.startsWith("logEntries/")) {
      reportAtFirstRow = await sink.readText(REPORT_PATH).catch(() => null);
    }
    return realWrite(path, data);
  };
  await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  assert.ok(reportAtFirstRow, "report.json exists before the first row");
  assert.equal(JSON.parse(reportAtFirstRow).state, "incomplete");
});

test("interrupted run: a throw while writing rows leaves report.json incomplete and sets no marker", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const realWrite = sink.write.bind(sink);
  sink.write = async (path: string, data: string | Uint8Array) => {
    if (path === "logEntries/l2.json") throw new Error("disk full mid-rows");
    return realWrite(path, data);
  };
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  assert.equal(result.state, "incomplete");
  const report = JSON.parse(await sink.readText(REPORT_PATH));
  assert.equal(report.state, "incomplete");
  assert.deepEqual(
    calls.filter((c) => c.startsWith("mark:")),
    [],
  );
});

test("pendingOutbox throw: a missing entry and an incomplete report, no marker", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  source.pendingOutbox = async () => {
    throw new Error("outbox unreadable");
  };
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason === "outbox-unreadable"));
  const report = JSON.parse(await sink.readText(REPORT_PATH));
  assert.equal(report.state, "incomplete");
  assert.deepEqual(
    calls.filter((c) => c.startsWith("mark:")),
    [],
  );
});

test("codec throw: a missing entry and an incomplete report, no marker", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const codec: FileCodec = {
    ...fakeCodec(SUPPORTED),
    toFile: () => {
      throw new Error("decode crashed");
    },
  };
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec, source, sink, now: NOW });
  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.kind === "logEntries" && m.reason === "codec-failed:logEntries"));
  assert.equal(JSON.stringify(result.run).includes("decode crashed"), false);
  const report = JSON.parse(await sink.readText(REPORT_PATH));
  assert.equal(report.state, "incomplete");
  assert.deepEqual(
    calls.filter((c) => c.startsWith("mark:")),
    [],
  );
});

test("verify listing throw: a missing entry and an incomplete report, no marker", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  sink.list = async () => {
    throw new Error("sink listing failed");
  };
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  assert.equal(result.state, "incomplete");
  // A failed listing with no readable report.json is refused before any write: it cannot be told apart from an unreadable report.
  assert.ok(result.run.missing.some((m) => m.reason === "report unreadable"));
  assert.equal(JSON.stringify(result.run.missing).includes("sink listing failed"), false);
  // Nothing is written over a report that may exist, so no report is written at all.
  const names = await MemorySink.prototype.list.call(sink);
  assert.equal(names.includes(REPORT_PATH), false);
  assert.deepEqual(
    calls.filter((c) => c.startsWith("mark:")),
    [],
  );
});

// In-memory KindWriter: write keeps rows, readBack returns them. Never touches the codec.
function memoryWriter(kind: string, opts: { dropOnReadBack?: boolean } = {}) {
  const stored: Row[] = [];
  const writer: KindWriter = {
    kinds: [kind],
    write: async (_k, row) => {
      stored.push(JSON.parse(JSON.stringify(row)) as Row);
    },
    readBack: async () => (opts.dropOnReadBack ? stored.slice(1) : stored.slice()),
  };
  return { writer, stored };
}

test("writer kinds: rows go through KindWriter.write, never the codec, and readBack must match", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const { writer, stored } = memoryWriter("logEntries");
  const codec: FileCodec = {
    ...fakeCodec(SUPPORTED),
    toFile: (kind, row) => {
      if (kind === "logEntries") throw new Error("codec must not be used for logEntries");
      return { path: `${kind}/${String(row.id)}.json`, text: JSON.stringify(row) };
    },
  };
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec,
    source,
    sink,
    now: NOW,
    writers: () => [writer],
  });
  assert.equal(result.state, "verified");
  assert.deepEqual(stored, FIXTURE.logEntries);
  assert.equal(result.run.kinds.logEntries?.written, 2);
  assert.equal(result.run.kinds.logEntries?.files, 2);
});

test("writer kinds: a readBack that loses a row makes the export incomplete", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const { writer } = memoryWriter("logEntries", { dropOnReadBack: true });
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    writers: () => [writer],
  });
  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.kind === "logEntries" && m.reason === "readback-differs"));
});

test("blobs: a server image/png and a stored octet-stream are different types, octet-stream and null are the same", () => {
  const row = (contentType: string | null) => ({ id: "b1", bucket: "ink", path: "a.png", contentType });
  assert.equal(sameRows("blobs", [row("image/png")], [row("application/octet-stream")]), false);
  assert.equal(sameRows("blobs", [row("image/png")], [row("image/png")]), true);
  assert.equal(sameRows("blobs", [row(null)], [row("application/octet-stream")]), true);
});

test("re-run conflict: a writer conflict is listed on the kind and the run is incomplete", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const writer: KindWriter = {
    kinds: ["logEntries"],
    write: async (_k, row) => {
      if (row.id === "l2") throw new Error("conflict: logEntry l2 exists with different content");
    },
    readBack: async () => (FIXTURE.logEntries ?? []).filter((r) => r.id !== "l2"),
  };
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW, writers: () => [writer] });
  assert.equal(result.state, "incomplete");
  assert.deepEqual(result.run.kinds.logEntries?.conflicts, ["l2"]);
  assert.equal(JSON.parse(await sink.readText(REPORT_PATH)).state, "incomplete");
});

test("failure reasons: a writer error is a fixed code; its message stays out of report.json and goes to the debug log", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const logs: string[] = [];
  const writer: KindWriter = {
    kinds: ["logEntries"],
    write: async (_k, row) => {
      if (row.id === "l1") throw new Error("SECRET body /home/x/private.md");
    },
    readBack: async () => (FIXTURE.logEntries ?? []).filter((r) => r.id !== "l1"),
  };
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW, writers: () => [writer],
    debugLog: (line) => logs.push(line),
  });
  const miss = result.run.missing.find((m) => m.kind === "logEntries" && m.id === "l1");
  assert.equal(miss?.reason, "write-failed:logEntries");
  assert.equal((await sink.readText(REPORT_PATH)).includes("SECRET"), false);
  assert.equal(logs.some((l) => l.includes("SECRET body /home/x/private.md")), true);
});

test("failure reasons: a codec error and a readBack error are fixed codes, never the error text", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const codec: FileCodec = { ...fakeCodec(SUPPORTED), toFile: () => { throw new Error("SECRET codec /home/x"); } };
  const writer: KindWriter = {
    kinds: ["logEntries"],
    write: async () => {},
    readBack: async () => { throw new Error("SECRET readBack /home/x"); },
  };
  source.listBlobs = async () => { throw new Error("SECRET list /home/x"); };
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec, source, sink, now: NOW, writers: () => [writer] });
  const reasons = result.run.missing.map((m) => m.reason);
  assert.equal(reasons.some((r) => r.startsWith("codec-failed:")), true);
  assert.equal(reasons.includes("logEntries: read failed"), true);
  assert.equal(reasons.includes("run-failed:blobs"), true);
  assert.equal((await sink.readText(REPORT_PATH)).includes("SECRET"), false);
});

test("blobs: a listBlobs failure makes the run incomplete, the report is not verified, no marker", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  source.listBlobs = async () => {
    throw new Error("blob listing failed: export incomplete");
  };
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  assert.equal(result.state, "incomplete");
  const report = JSON.parse(await sink.readText(REPORT_PATH));
  assert.notEqual(report.state, "verified");
  assert.deepEqual(calls.filter((c) => c.startsWith("mark:")), []);
});

test("verify: a blob whose length differs from size_bytes is incomplete, even if its sha matches the sidecar", async () => {
  const bytes = new Uint8Array([9, 8, 7]);
  const ref: BlobRef = { bucket: "ink", path: "img/a.png", sizeBytes: 4 };
  const sink = new MemorySink();
  await sink.write("assets/ink/img/a.png", bytes);
  await sink.write("assets/ink/img/a.png.sha256", sha(bytes));
  const { source } = fakeServer({ rows: {}, blobs: [{ ref, bytes }] });
  const verdict = await verifyExport({ kinds: [], codec: fakeCodec([]), source, sink });
  assert.equal(verdict.blobs.verified, 0);
  assert.equal(verdict.state, "incomplete");
});

test("verify: a blob sidecar with a content-type line still verifies on its sha256 line", async () => {
  const bytes = new Uint8Array([9, 8, 7]);
  const ref: BlobRef = { bucket: "ink", path: "img/a.png", sizeBytes: bytes.length };
  const sink = new MemorySink();
  await sink.write(`assets/${ref.bucket}/${ref.path}`, bytes);
  await sink.write(`assets/${ref.bucket}/${ref.path}.sha256`, `${sha(bytes)}\nimage/png`);
  const { source } = fakeServer({ rows: {}, blobs: [{ ref, bytes }] });
  const verdict = await verifyExport({ kinds: [], codec: fakeCodec([]), source, sink });
  assert.deepEqual(verdict.errors, []);
  assert.equal(verdict.blobs.verified, 1);
});

// KEYS hook: moveSecrets runs after a verified run and before either marker; no-op when absent.
test("keys: moveSecrets runs after verify and before the desktop mark and the server marker", async () => {
  const order: string[] = [];
  const sink = new MemorySink();
  const { source } = fakeServer({ rows: FIXTURE });
  const realMark = source.markExported097;
  source.markExported097 = async () => {
    order.push("server-mark");
    await realMark();
  };
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    desktop: {
      folder: "C:/ws",
      bridge: {
        backup: async () => ({ deviceId: "dev-1", dump: "pre-migration-097.dump" }),
        markExported: async () => {
          order.push("desktop-mark");
        },
      },
    },
    moveSecrets: async () => {
      const logs = (await sink.list()).filter((p) => p.startsWith("logEntries/"));
      order.push(`moveSecrets:rows=${logs.length}`);
    },
  });
  assert.equal(result.state, "verified");
  assert.match(order[0] ?? "", /^moveSecrets:rows=[1-9]/, "rows were written before the hook ran");
  assert.deepEqual(order.slice(1), ["server-mark", "desktop-mark"]);
});

test("keys: a failed moveSecrets gives incomplete, no desktop mark and no server marker", async () => {
  const desktopCalls: string[] = [];
  const sink = new MemorySink();
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    desktop: { folder: "C:/ws", bridge: fakeDesktop(desktopCalls) },
    moveSecrets: async () => {
      throw new Error("keys refused");
    },
  });
  assert.equal(result.state, "incomplete");
  assert.equal(desktopCalls.some((c) => c.startsWith("desktop-mark")), false, "desktop mark not called");
  assert.equal(calls.some((c) => c.startsWith("mark:")), false, "server marker not set");
  assert.match(JSON.stringify(result.run.missing), /keys: move failed/);
  const report = JSON.parse(await sink.readText(REPORT_PATH)) as { state: string };
  assert.equal(report.state, "incomplete");
});

test("reasons: report.json and the run never carry a thrown message (fixed codes only)", async () => {
  // Move failure: the thrown text holds a secret-like value that must not reach the report.
  const sinkA = new MemorySink();
  await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source: fakeServer({ rows: FIXTURE }).source,
    sink: sinkA,
    now: NOW,
    moveSecrets: async () => {
      throw new Error("LEAK-KEY-sk-live-111");
    },
  });
  const textA = await sinkA.readText(REPORT_PATH);
  assert.equal(textA.includes("LEAK-KEY"), false, "move message not in report");
  assert.match(textA, /keys: move failed/);

  // Server marker failure.
  const { source: srv } = fakeServer({ rows: FIXTURE });
  srv.markExported097 = async () => {
    throw new Error("LEAK-SERVER-token-222");
  };
  const sinkB = new MemorySink();
  await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source: srv, sink: sinkB, now: NOW });
  const textB = await sinkB.readText(REPORT_PATH);
  assert.equal(textB.includes("LEAK-SERVER"), false, "server message not in report");
  assert.match(textB, /marker: server failed/);

  // Desktop mark failure.
  const sinkC = new MemorySink();
  await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source: fakeServer({ rows: FIXTURE }).source,
    sink: sinkC,
    now: NOW,
    desktop: {
      folder: "C:/ws",
      bridge: {
        backup: async () => ({ deviceId: "dev-1", dump: "pre-migration-097.dump" }),
        markExported: async () => {
          throw new Error("LEAK-DESKTOP-path-333");
        },
      },
    },
  });
  const textC = await sinkC.readText(REPORT_PATH);
  assert.equal(textC.includes("LEAK-DESKTOP"), false, "desktop message not in report");
  assert.match(textC, /marker: desktop failed/);
});

test("keys: moveSecrets does not run when the run is incomplete", async () => {
  class FlakySink extends MemorySink {
    override async write(path: string, data: string | Uint8Array): Promise<void> {
      if (path.includes("l2")) throw new Error("disk full");
      return super.write(path, data);
    }
  }
  const { source, calls } = fakeServer({ rows: FIXTURE });
  let moved = false;
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink: new FlakySink(),
    now: NOW,
    moveSecrets: async () => {
      moved = true;
    },
  });
  assert.equal(result.state, "incomplete");
  assert.equal(moved, false);
  assert.equal(calls.some((c) => c.startsWith("mark:")), false);
});

// P3: the missing detail names the first differing id and field; syncState is local-only.
test("verify: the differing detail names the first differing id and field", async () => {
  const sink = new MemorySink();
  const { source } = fakeServer({ rows: { experiments: [{ id: "e1", name: "Exp", n: 3 }] } });
  await sink.write("experiments/e1.json", JSON.stringify({ id: "e1", name: "Exp", n: 4 }));
  const verdict = await verifyExport({ kinds: ["experiments"], codec: fakeCodec(SUPPORTED), source, sink });
  const msg = verdict.errors.find((e) => e.startsWith("experiments: decoded files differ")) ?? "";
  assert.match(msg, /id e1/);
  assert.match(msg, /field n/);
});

test("verify: syncState is local-only and is not compared", () => {
  const want = [{ id: "e1", name: "Exp", syncState: "synced" }];
  const got = [{ id: "e1", name: "Exp" }];
  assert.equal(sameRows("experiments", want, got), true);
});

test("keys: secrets present but no mover refuses the run and writes an incomplete report", async () => {
  const sink = new MemorySink();
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    secretsPresent: true,
  });
  assert.equal(result.state, "incomplete");
  assert.equal(calls.some((c) => c.startsWith("mark:")), false, "no server marker without a mover");
  const report = JSON.parse(await sink.readText(REPORT_PATH)) as { state: string };
  assert.equal(report.state, "incomplete");
  assert.match(JSON.stringify(report), /keys: no mover/);
});

test("refused runs (outbox not empty) still write an incomplete report with the reason", async () => {
  const sink = new MemorySink();
  const { source } = fakeServer({ rows: FIXTURE });
  source.pendingOutbox = async () => 2;
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  assert.equal(result.state, "incomplete");
  const report = JSON.parse(await sink.readText(REPORT_PATH)) as { state: string };
  assert.equal(report.state, "incomplete");
  assert.match(JSON.stringify(report), /outbox not empty/);
});

test("keys: copy-only mover; a failed marker then a re-run copies each secret once and verifies", async () => {
  const sec = new Map([
    ["k1", "v1"],
    ["k2", "v2"],
  ]);
  const target = new Map<string, string>();
  const copies: string[] = [];
  const moveSecrets = createSecretMover({
    list: async () => [...sec.keys()],
    exists: async (id) => target.has(id),
    copy: async (id) => {
      copies.push(id);
      target.set(id, sec.get(id) ?? "");
    },
  });
  const sink = new MemorySink();
  const { source } = fakeServer({ rows: FIXTURE });
  const realMark = source.markExported097;
  source.markExported097 = async () => {
    throw new Error("server down");
  };
  const first = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    secretsPresent: true,
    moveSecrets,
  });
  assert.equal(first.state, "incomplete");

  source.markExported097 = realMark;
  const second = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    secretsPresent: true,
    moveSecrets,
  });
  assert.equal(second.state, "verified");
  assert.deepEqual(copies, ["k1", "k2"], "each secret copied once across both runs");
  assert.deepEqual([...sec.keys()], ["k1", "k2"], "old secrets still present");
  const report = JSON.parse(await sink.readText(REPORT_PATH)) as { state: string };
  assert.equal(report.state, "verified");
});

test("runs: a run replaces this device's entry and keeps another device's entry, twice over", async () => {
  const other: RunReport = {
    startedAt: "2026-11-01T00:00:00.000Z",
    finishedAt: "2026-11-01T00:00:01.000Z",
    sources: ["server"],
    kinds: {},
    blobs: { db: 0, verified: 0 },
    missing: [],
    deviceId: "dev-other",
  };
  const sink = new MemorySink();
  const stale: RunReport = { ...other, deviceId: "web-me", startedAt: "2026-11-02T00:00:00.000Z" };
  await sink.write(REPORT_PATH, JSON.stringify({ version: 1, state: "incomplete", backup: null, runs: [other, stale] }));
  const { source } = fakeServer({ rows: FIXTURE });
  const exportOnce = () =>
    runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW, runDeviceId: "web-me" });

  await exportOnce();
  const first = (JSON.parse(await sink.readText(REPORT_PATH)) as { runs: RunReport[] }).runs;
  assert.equal(first.length, 2);
  assert.deepEqual(first[0], other);
  assert.equal(first[1]?.deviceId, "web-me");
  assert.equal(first[1]?.startedAt, NOW);

  await exportOnce();
  const second = (JSON.parse(await sink.readText(REPORT_PATH)) as { runs: RunReport[] }).runs;
  assert.equal(second.length, 2, "the same device is replaced, never duplicated");
  assert.deepEqual(second[0], other);
});

test("runs: a web run with no runDeviceId is refused with a fixed reason, never a fresh device id", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const result = await runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  assert.equal(result.state, "incomplete");
  assert.deepEqual(result.run.missing.map((m) => m.reason), ["device id missing"]);
  assert.equal(result.run.deviceId, undefined);
});

test("runs: a device's run replaces only its own older runs; another device's failed run stays and is named", async () => {
  const other: RunReport = {
    startedAt: "2026-11-01T00:00:00.000Z",
    finishedAt: "2026-11-01T00:00:01.000Z",
    sources: ["server"],
    kinds: {},
    blobs: { db: 0, verified: 0 },
    missing: [{ kind: "notes", id: "n1", reason: "x" }],
    deviceId: "dev-other",
  };
  const mineOld: RunReport = { ...other, deviceId: "web-me", startedAt: "2026-11-02T00:00:00.000Z" };
  const sink = new MemorySink();
  await sink.write(REPORT_PATH, JSON.stringify({ version: 1, state: "incomplete", backup: null, runs: [other, mineOld] }));
  const { source } = fakeServer({ rows: FIXTURE });
  await runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW, runDeviceId: "web-me" });
  const report = JSON.parse(await sink.readText(REPORT_PATH)) as { runs: RunReport[] };
  assert.equal(report.runs.filter((r) => r.deviceId === "web-me").length, 1, "own older run replaced");
  assert.equal(report.runs.filter((r) => r.deviceId === "dev-other").length, 1, "other device's run kept");
  // KINDS is a subset here, so web-me's own run is not clean either; the point is that dev-other is named.
  assert.ok(unverifiedDevices(report as Parameters<typeof unverifiedDevices>[0]).includes("dev-other"));
});

test("per-kind failure: a failed kind is listed missing and the later kinds still export", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE, failKind: "logEntries" });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });

  assert.equal(result.state, "incomplete");
  assert.deepEqual(
    result.run.missing.filter((m) => m.kind === "logEntries").map((m) => m.reason),
    ["logEntries: read failed"],
  );
  assert.equal(result.run.kinds.experiments?.written, 1);
  assert.ok((await sink.list()).includes("experiments/e1.json"), "the later kind is still written");
  assert.equal(calls.some((c) => c.startsWith("mark:")), false);
});

test("target: a web run records target opfs in report.json", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  const report = JSON.parse(await sink.readText(REPORT_PATH)) as { target?: string };
  assert.equal(report.target, "opfs");
});

test("target: a desktop run records target folder in report.json", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    desktop: { folder: "C:/ws", bridge: fakeDesktop(calls) },
  });
  const report = JSON.parse(await sink.readText(REPORT_PATH)) as { target?: string };
  assert.equal(report.target, "folder");
});

test("zip-only export: the zip never writes a verified report, so the browser writes stay on", async () => {
  const sink = new MemorySink();
  const zip = await buildDownloadZip(sink);
  assert.equal(unzipFiles(zip).has(REPORT_PATH), false);
  assert.equal(writesOff(null), false);
});

test("writesOff: only a verified report with target opfs switches the browser writes off", () => {
  assert.equal(writesOff({ state: "verified", target: "opfs" }), true);
  assert.equal(writesOff({ state: "verified", target: "folder" }), false);
  assert.equal(writesOff({ state: "incomplete", target: "opfs" }), false);
  assert.equal(writesOff({ state: "verified" }), false);
  assert.equal(writesOff(undefined), false);
});

test("readMigrationReport: an absent report gives null", async () => {
  assert.equal(await readMigrationReport(new MemorySink()), null);
});

test("readMigrationReport: corrupt JSON gives null and never throws", async () => {
  const sink = new MemorySink();
  await sink.write(REPORT_PATH, "{not json");
  assert.equal(await readMigrationReport(sink), null);
});

test("readMigrationReport: JSON that is not a report (null, or an unknown state) gives null", async () => {
  const sink = new MemorySink();
  await sink.write(REPORT_PATH, "null");
  assert.equal(await readMigrationReport(sink), null);
  await sink.write(REPORT_PATH, JSON.stringify({ state: "done" }));
  assert.equal(await readMigrationReport(sink), null);
});

test("readMigrationReport: the report the web export writes reads back and switches writes off", async () => {
  const { source } = fakeServer({ rows: {} });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: [], codec: fakeCodec([]), source, sink, now: NOW });
  assert.equal(result.state, "verified");
  const report = await readMigrationReport(sink);
  assert.ok(report);
  assert.equal(report.state, "verified");
  assert.equal(report.target, "opfs");
  assert.deepEqual(report, JSON.parse(await sink.readText(REPORT_PATH)));
  assert.equal(writesOff(report), true);
});

const TRASH_ROW = { id: "t1", body: "gone", deleted_at: "2026-11-01T00:00:00.000Z" };
const TRASH_PATH = ".weaveforge/migration-0.9.7/trash/logEntries/t1.json";

test("trash: a trashed row is exported as raw JSON, read back equal, and counted per kind", async () => {
  const { source } = fakeServer({ rows: FIXTURE, trashed: { logEntries: [TRASH_ROW] } });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });

  assert.deepEqual(JSON.parse(await sink.readText(TRASH_PATH)), TRASH_ROW);
  assert.equal(result.run.kinds.logEntries?.trash, 1);
  assert.equal(result.run.kinds.experiments?.trash, 0);
  assert.equal(result.run.missing.filter((m) => m.reason.startsWith("trash")).length, 0);
});

test("trash: an encrypted trashed row is written as the codec decode, equal to the live decode", async () => {
  // Fake decrypt: content_enc is turned into plaintext by the same codec the live rows use.
  const codec: FileCodec = {
    supports: (kind) => kind === "logEntries",
    toFile: (kind, row) => ({
      path: `${kind}/${String(row.id)}.json`,
      text: row.contentEnc === undefined ? JSON.stringify(row) : JSON.stringify({ id: row.id, body: `plain:${String(row.contentEnc)}` }),
    }),
    toRow: () => null,
  };
  const encrypted = { id: "t7", contentEnc: "cipher-7" };
  const { source } = fakeServer({ rows: FIXTURE, trashed: { logEntries: [encrypted] } });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec, source, sink, now: NOW });

  const liveDecode = codec.toFile("logEntries", encrypted).text;
  assert.equal(await sink.readText(".weaveforge/migration-0.9.7/trash/logEntries/t7.json"), liveDecode);
  assert.equal(result.run.kinds.logEntries?.trash, 1);
  assert.equal(result.run.missing.filter((m) => m.reason.startsWith("trash")).length, 0);
});

test("trash: a trash file that does not read back equal goes to missing, state incomplete, no marker", async () => {
  class TamperingSink extends MemorySink {
    override async readText(path: string): Promise<string> {
      return path.includes("/trash/") ? JSON.stringify({ id: "t1", body: "changed" }) : super.readText(path);
    }
  }
  const { source, calls } = fakeServer({ rows: FIXTURE, trashed: { logEntries: [TRASH_ROW] } });
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink: new TamperingSink(), now: NOW,
  });

  assert.equal(result.state, "incomplete");
  assert.deepEqual(
    result.run.missing.filter((m) => m.kind === "logEntries" && m.reason.startsWith("trash")),
    [{ kind: "logEntries", id: "t1", reason: "trash read-back mismatch" }],
  );
  assert.equal(calls.some((c) => c.startsWith("mark:")), false);
});

test("trash: a trashed row with no id is listed missing as missing id and writes no file, state incomplete", async () => {
  const { source } = fakeServer({ rows: {}, trashed: { logEntries: [{ text: "no id" } as Row] } });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });

  assert.equal(result.state, "incomplete");
  assert.deepEqual(
    result.run.missing.filter((m) => m.kind === "logEntries"),
    [{ kind: "logEntries", id: "*", reason: "missing id" }],
  );
  assert.equal((await sink.list()).some((p) => p.includes("undefined")), false);
});

test("backup: device A's backup stays in A's runs entry and the report-level backup after a web run by device B", async () => {
  const sink = new MemorySink();
  const bridge = {
    backup: async () => ({ deviceId: "dev-a", dump: "dump-a.zip" }),
    markExported: async () => {},
  };
  const a = fakeServer({ rows: {} });
  await runWebExport({ kinds: [], codec: fakeCodec([]), source: a.source, sink, now: NOW, desktop: { folder: "/vault", bridge } });

  const b = fakeServer({ rows: {} });
  await runWebExport({ runDeviceId: "dev-b", kinds: [], codec: fakeCodec([]), source: b.source, sink, now: NOW });

  const report = JSON.parse(await sink.readText(REPORT_PATH)) as { backup: string | null; runs: RunReport[] };
  assert.equal(report.runs.find((r) => r.deviceId === "dev-a")?.backup, "dump-a.zip");
  assert.equal(report.runs.find((r) => r.deviceId === "dev-b")?.backup, null);
  assert.equal(report.backup, "dump-a.zip");
});
