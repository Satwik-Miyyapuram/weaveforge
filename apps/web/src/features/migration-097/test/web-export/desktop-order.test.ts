import { onlyReportPath } from "../own-report";
import assert from "node:assert/strict";
import { test } from "node:test";
import { REPORT_PATH, type RunReport } from "../../domain/report";
import type { FileCodec, Row } from "../../domain/ports";
import { runWebExport } from "../../application/run-web-export";
import { MemorySink } from "../../infrastructure/memory-sink";
import { NOW, fakeCodec, fakeServer, FIXTURE, KINDS, SUPPORTED, fakeDesktop } from "./helpers";

type RunReportFile = { state: string; runs: { state: string; missing: unknown[] }[] };

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
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink))) as { deviceId?: string };
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
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink)));
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
  assert.deepEqual(await sink.list(), []);
});

test("desktop: a pre-backup refusal writes nothing, even when the run names a device id", async () => {
  const sink = new MemorySink();
  await sink.write(REPORT_PATH, "{ not json");
  const before = await sink.list();
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec: fakeCodec(SUPPORTED),
    source,
    sink,
    now: NOW,
    desktop: { folder: "C:/ws", bridge: fakeDesktop(calls) },
  });
  assert.notEqual(result.state, "verified");
  assert.deepEqual(calls, []);
  assert.deepEqual(await sink.list(), before, "no report is written before the dump");
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
  assert.deepEqual(await sink.list(), []);
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
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink))) as { deviceId?: unknown; runs: RunReport[] };
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

test("order: the server marker comes first, the desktop mark last, and the desktop mark sees a verified run on disk", async () => {
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
          // As the shell's check_own_run_verdict: this device's run must be verified with nothing missing.
          const report = JSON.parse(await sink.readText(await onlyReportPath(sink))) as RunReportFile;
          const run = report.runs.at(-1);
          order.push(`desktop-mark:report=${report.state}:run=${run?.state}:missing=${run?.missing.length}`);
        },
      },
    },
  });
  assert.equal(result.state, "verified");
  assert.deepEqual(order, ["server-mark", "desktop-mark:report=verified:run=verified:missing=0"]);
  const final = JSON.parse(await sink.readText(await onlyReportPath(sink))) as { state: string };
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
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink))) as { state: string; verifiedAt?: string };
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
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink))) as { state: string };
  assert.equal(report.state, "incomplete");
  assert.match(JSON.stringify(report), /marker: server failed/);
});

test("order: a desktop mark that throws after the server marker leaves report.json incomplete", async () => {
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
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink))) as { state: string; verifiedAt?: string };
  assert.equal(report.state, "incomplete");
  assert.equal("verifiedAt" in report, false);
});

test("order: report.json says markers pending before any mark is attempted", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const seen: string[] = [];
  source.markExported097 = async () => {
    const report = JSON.parse(await sink.readText(await onlyReportPath(sink))) as {
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
    if (/\/report-[^/]+\.json$/.test(to)) throw new Error("disk full writing report");
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
  const firstRow: { report?: string | null } = {};
  sink.write = async (path: string, data: string | Uint8Array) => {
    if (firstRow.report === undefined && path.startsWith("logEntries/")) {
      firstRow.report = await sink.readText(await onlyReportPath(sink)).catch(() => null);
    }
    return realWrite(path, data);
  };
  await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  assert.ok(firstRow.report, "report.json exists before the first row");
  assert.equal(JSON.parse(firstRow.report).state, "incomplete");
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
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink)));
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
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink)));
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
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink)));
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
  assert.ok(result.run.missing.some((m) => /is unreadable|cannot be listed/.test(m.reason)));
  assert.equal(JSON.stringify(result.run.missing).includes("sink listing failed"), false);
  // Nothing is written over a report that may exist, so no report is written at all.
  const names = await MemorySink.prototype.list.call(sink);
  assert.equal(names.some((p) => /\/report[^/]*\.json$/.test(p)), false);
  assert.deepEqual(
    calls.filter((c) => c.startsWith("mark:")),
    [],
  );
});
