import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { REPORT_PATH } from "../domain/report";
import { SERVER_ONLY_FIELDS } from "../domain/server-only-fields";
import type { BlobRef, FileCodec, Row, ServerSource } from "../domain/ports";
import type { KindWriter } from "../domain/kind-writer";
import { runWebExport } from "../application/run-web-export";
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
  assert.ok(result.run.missing.length > 0);
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
  assert.ok(result.run.missing.some((m) => m.kind === "logEntries" && m.reason.includes("raw count")));
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

test("report has verifiedAt when verified, no runs errors field, and is written atomically", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const events: { kind: string; done: number; total: number }[] = [];
  const result = await runWebExport({
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

test("download-your-data zip is built from the sink only, never marks the server, and keeps an incomplete report", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE, failKind: "experiments" });
  const sink = new MemorySink();
  await runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
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
  await runWebExport({ kinds: ["experiments"], codec, source, sink, now: NOW });
  const verdict = await verifyExport({ kinds: ["experiments"], codec, source, sink });
  assert.equal(verdict.state, "verified");
});

test("verify allow-list: an unlisted server column the file lacks is a mismatch", async () => {
  const rows = { experiments: [{ id: "e9", name: "Z", secretOther: "x" }] };
  const { source } = fakeServer({ rows });
  const codec = codecDropping(["experiments"], ["secretOther"]);
  const sink = new MemorySink();
  await runWebExport({ kinds: ["experiments"], codec, source, sink, now: NOW });
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
  await runWebExport({ kinds: ["experiments"], codec, source, sink, now: NOW });
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
  const { state, run } = await runWebExport({ kinds: ["experiments"], codec, source, sink, now: NOW });
  assert.equal(state, "incomplete");
  assert.ok(run.missing.some((m) => m.kind === "experiments" && m.id === "bad" && m.reason.includes("cannot encode")));
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
  const result = await runWebExport({
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
  await runWebExport({
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
  const result = await runWebExport({
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
  assert.deepEqual(await sink.list(), []);
});

test("desktop: a failed backup aborts the export: no server read, no write, no marker, no mark-exported", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const result = await runWebExport({
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    desktop: { folder: "C:/ws", bridge: fakeDesktop(calls, { backupFails: true }) },
  });

  assert.equal(result.state, "none");
  assert.match(result.run.missing[0]!.reason, /backup failed: disk full/);
  assert.deepEqual(calls, ["backup:C:/ws"]);
  assert.deepEqual(await sink.list(), []);
});

test("desktop: mark-exported runs only after a verified run", async () => {
  const calls: string[] = [];
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const result = await runWebExport({
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
  const result = await runWebExport({
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

test("web: no desktop bridge means no deviceId key in report.json", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  await runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  const report = JSON.parse(await sink.readText(REPORT_PATH)) as Record<string, unknown>;
  assert.equal("deviceId" in report, false);
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
  const result = await runWebExport({ kinds: ["blobs"], codec, source, sink: new MemorySink(), now: NOW });
  assert.equal(result.state, "verified");
});

test("order: report.json says verified before the desktop mark, and the server marker comes last", async () => {
  const order: string[] = [];
  const sink = new MemorySink();
  const { source } = fakeServer({ rows: FIXTURE });
  const realMark = source.markExported;
  source.markExported = async (at) => {
    order.push("server-mark");
    await realMark(at);
  };
  const result = await runWebExport({
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
  assert.deepEqual(order, ["desktop-mark:report=verified", "server-mark"]);
});

test("order: a failed desktop mark means no server marker and report.json stays incomplete", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const desktopCalls: string[] = [];
  const result = await runWebExport({
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    desktop: { folder: "C:/ws", bridge: fakeDesktop(desktopCalls, { markFails: true }) },
  });
  assert.equal(result.state, "incomplete");
  assert.equal(calls.some((c) => c.startsWith("mark:")), false, "server marker not set");
  const report = JSON.parse(await sink.readText(REPORT_PATH)) as { state: string; verifiedAt?: string };
  assert.equal(report.state, "incomplete");
  assert.equal("verifiedAt" in report, false);
  assert.match(JSON.stringify(report), /markExported: shell refused/);
});

test("order: a failed server marker leaves report.json incomplete", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  source.markExported = async () => {
    throw new Error("server down");
  };
  const sink = new MemorySink();
  const result = await runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  assert.equal(result.state, "incomplete");
  const report = JSON.parse(await sink.readText(REPORT_PATH)) as { state: string };
  assert.equal(report.state, "incomplete");
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
    runWebExport({
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
  await runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
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
  const result = await runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
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
  const result = await runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason.includes("outbox unreadable")));
  const report = JSON.parse(await sink.readText(REPORT_PATH));
  assert.equal(report.state, "incomplete");
  assert.deepEqual(
    calls.filter((c) => c.startsWith("mark:")),
    [],
  );
});

test("verify throw: a missing entry and an incomplete report, no marker", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const codec: FileCodec = {
    ...fakeCodec(SUPPORTED),
    toRow: () => {
      throw new Error("decode crashed");
    },
  };
  const sink = new MemorySink();
  const result = await runWebExport({ kinds: KINDS, codec, source, sink, now: NOW });
  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason.includes("decode crashed")));
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
  const result = await runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason.includes("sink listing failed")));
  const report = JSON.parse(await sink.readText(REPORT_PATH));
  assert.equal(report.state, "incomplete");
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
  const result = await runWebExport({
    kinds: KINDS,
    codec,
    source,
    sink,
    now: NOW,
    writers: [writer],
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
  const result = await runWebExport({
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    writers: [writer],
  });
  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.kind === "logEntries" && m.reason.includes("readBack")));
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
  const result = await runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW, writers: [writer] });
  assert.equal(result.state, "incomplete");
  assert.deepEqual(result.run.kinds.logEntries?.conflicts, ["l2"]);
  assert.equal(JSON.parse(await sink.readText(REPORT_PATH)).state, "incomplete");
});

test("blobs fail closed: listBlobs throws, so the run is incomplete, the report is not verified, no marker", async () => {
  // TODO(097-blob-sha): blob_objects has no sha256 column, so listing stays fail-closed until the server adds one.
  const { source, calls } = fakeServer({ rows: FIXTURE });
  source.listBlobs = async () => {
    throw new Error("blob listing not implemented: export incomplete");
  };
  const sink = new MemorySink();
  const result = await runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  assert.equal(result.state, "incomplete");
  const report = JSON.parse(await sink.readText(REPORT_PATH));
  assert.notEqual(report.state, "verified");
  assert.deepEqual(calls.filter((c) => c.startsWith("mark:")), []);
});

test("verify: a blob sidecar with a content-type line still verifies on its sha256 line", async () => {
  const bytes = new Uint8Array([9, 8, 7]);
  const ref: BlobRef = { bucket: "ink", path: "img/a.png", sha256: sha(bytes) };
  const sink = new MemorySink();
  await sink.write(`assets/${ref.bucket}/${ref.path}`, bytes);
  await sink.write(`assets/${ref.bucket}/${ref.path}.sha256`, `${ref.sha256}\nimage/png`);
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
  const realMark = source.markExported;
  source.markExported = async (at) => {
    order.push("server-mark");
    await realMark(at);
  };
  const result = await runWebExport({
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
  assert.deepEqual(order.slice(1), ["desktop-mark", "server-mark"]);
});

test("keys: a failed moveSecrets gives incomplete, no desktop mark and no server marker", async () => {
  const desktopCalls: string[] = [];
  const sink = new MemorySink();
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const result = await runWebExport({
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
  assert.match(JSON.stringify(result.run.missing), /moveSecrets: keys refused/);
  const report = JSON.parse(await sink.readText(REPORT_PATH)) as { state: string };
  assert.equal(report.state, "incomplete");
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
  const result = await runWebExport({
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
