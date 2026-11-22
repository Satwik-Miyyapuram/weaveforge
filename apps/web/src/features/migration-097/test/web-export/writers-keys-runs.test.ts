import { onlyReportPath } from "../own-report";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictError } from "@weaveforge/core";
import { REPORT_PATH, readMigrationRuns, unverifiedDevices, writesOff, type RunReport } from "../../domain/report";
import type { BlobRef, FileCodec, Row } from "../../domain/ports";
import type { KindWriter } from "../../domain/kind-writer";
import { runWebExport } from "../../application/run-web-export";
import { createSecretMover } from "../../application/move-secrets";
import { sameRows, verifyExport } from "../../application/verify-export";
import { MemorySink } from "../../infrastructure/memory-sink";
import { unzipFiles } from "../../infrastructure/zip";
import { buildDownloadZip } from "../../application/download-export";
import { NOW, sha, fakeCodec, fakeServer, FIXTURE, KINDS, SUPPORTED, fakeDesktop, memoryWriter } from "./helpers";

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
      if (row.id === "l2") throw new ConflictError("logEntry l2 exists with different content");
    },
    readBack: async () => (FIXTURE.logEntries ?? []).filter((r) => r.id !== "l2"),
  };
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW, writers: () => [writer] });
  assert.equal(result.state, "incomplete");
  assert.deepEqual(result.run.kinds.logEntries?.conflicts, ["l2"]);
  assert.equal(JSON.parse(await sink.readText(await onlyReportPath(sink))).state, "incomplete");
});

test("re-run conflict: a plain Error that only says conflict: in its message is a write failure, not a conflict", async () => {
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
  assert.deepEqual(result.run.kinds.logEntries?.conflicts ?? [], []);
  assert.ok(result.run.missing.some((m) => m.kind === "logEntries" && m.id === "l2" && m.reason === "write-failed:logEntries"));
});

test("re-run conflict: a typed ConflictError is a conflict whatever its message says", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const writer: KindWriter = {
    kinds: ["logEntries"],
    write: async (_k, row) => {
      if (row.id === "l2") throw new ConflictError("logEntry l2 differs from the file");
    },
    readBack: async () => (FIXTURE.logEntries ?? []).filter((r) => r.id !== "l2"),
  };
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW, writers: () => [writer] });
  assert.deepEqual(result.run.kinds.logEntries?.conflicts, ["l2"]);
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
  assert.equal((await sink.readText(await onlyReportPath(sink))).includes("SECRET"), false);
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
  assert.equal((await sink.readText(await onlyReportPath(sink))).includes("SECRET"), false);
});

test("blobs: a listBlobs failure makes the run incomplete, the report is not verified, no marker", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  source.listBlobs = async () => {
    throw new Error("blob listing failed: export incomplete");
  };
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  assert.equal(result.state, "incomplete");
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink)));
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
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink))) as { state: string };
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
  const textA = await sinkA.readText(await onlyReportPath(sinkA));
  assert.equal(textA.includes("LEAK-KEY"), false, "move message not in report");
  assert.match(textA, /keys: move failed/);

  // Server marker failure.
  const { source: srv } = fakeServer({ rows: FIXTURE });
  srv.markExported097 = async () => {
    throw new Error("LEAK-SERVER-token-222");
  };
  const sinkB = new MemorySink();
  await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source: srv, sink: sinkB, now: NOW });
  const textB = await sinkB.readText(await onlyReportPath(sinkB));
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
  const textC = await sinkC.readText(await onlyReportPath(sinkC));
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

test("refused runs (outbox not empty) still write an incomplete report with the reason", async () => {
  const sink = new MemorySink();
  const { source } = fakeServer({ rows: FIXTURE });
  source.pendingOutbox = async () => 2;
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW });
  assert.equal(result.state, "incomplete");
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink))) as { state: string };
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
    moveSecrets,
  });
  assert.equal(second.state, "verified");
  assert.deepEqual(copies, ["k1", "k2"], "each secret copied once across both runs");
  assert.deepEqual([...sec.keys()], ["k1", "k2"], "old secrets still present");
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink))) as { state: string };
  assert.equal(report.state, "verified");
});

test("runs: a run writes only this device's file, never rewrites the legacy report, twice over", async () => {
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
  const legacy = JSON.stringify({ version: 1, state: "incomplete", backup: null, runs: [other, stale] });
  await sink.write(REPORT_PATH, legacy);
  const { source } = fakeServer({ rows: FIXTURE });
  const exportOnce = () =>
    runWebExport({ kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW, runDeviceId: "web-me" });

  await exportOnce();
  const first = (JSON.parse(await sink.readText(await onlyReportPath(sink))) as { runs: RunReport[] }).runs;
  assert.equal(first.length, 1, "the own file holds only this device's run");
  assert.equal(first[0]?.deviceId, "web-me");
  assert.equal(first[0]?.startedAt, NOW);
  assert.equal(await sink.readText(REPORT_PATH), legacy, "the legacy report keeps its bytes");

  await exportOnce();
  const second = (JSON.parse(await sink.readText(await onlyReportPath(sink))) as { runs: RunReport[] }).runs;
  assert.equal(second.length, 1, "the same device is replaced, never duplicated");
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
  const own = JSON.parse(await sink.readText(await onlyReportPath(sink))) as { runs: RunReport[] };
  assert.equal(own.runs.filter((r) => r.deviceId === "dev-other").length, 0, "another device's run is never copied into this file");
  // Readers union every file: dev-other's failed run in the legacy report is still named as unverified.
  const runs = await readMigrationRuns(sink);
  assert.ok(runs !== null && unverifiedDevices({ runs }).includes("dev-other"));
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
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink))) as { target?: string };
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
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink))) as { target?: string };
  assert.equal(report.target, "folder");
});

test("zip-only export: the zip never writes a verified report, so the browser writes stay on", async () => {
  const sink = new MemorySink();
  const zip = await buildDownloadZip(sink);
  assert.equal([...unzipFiles(zip).keys()].some((p) => p.includes("report")), false);
  assert.equal(writesOff(null), false);
});

test("writesOff: only a verified report with target opfs switches the browser writes off", () => {
  assert.equal(writesOff({ state: "verified", target: "opfs" }), true);
  assert.equal(writesOff({ state: "verified", target: "folder" }), false);
  assert.equal(writesOff({ state: "incomplete", target: "opfs" }), false);
  assert.equal(writesOff({ state: "verified" }), false);
  assert.equal(writesOff(undefined), false);
});

test("readMigrationRuns: an absent report gives an empty list", async () => {
  assert.deepEqual(await readMigrationRuns(new MemorySink()), []);
});

test("readMigrationRuns: corrupt JSON gives null and never throws", async () => {
  const sink = new MemorySink();
  await sink.write(REPORT_PATH, "{not json");
  assert.equal(await readMigrationRuns(sink), null);
});

test("readMigrationRuns: JSON that is not a report (null, or an unknown state) gives null", async () => {
  const sink = new MemorySink();
  await sink.write(REPORT_PATH, "null");
  assert.equal(await readMigrationRuns(sink), null);
  await sink.write(REPORT_PATH, JSON.stringify({ state: "done" }));
  assert.equal(await readMigrationRuns(sink), null);
});

test("readMigrationRuns: the report the web export writes reads back and switches writes off", async () => {
  const { source } = fakeServer({ rows: {} });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: [], codec: fakeCodec([]), source, sink, now: NOW });
  assert.equal(result.state, "verified");
  const own = JSON.parse(await sink.readText(await onlyReportPath(sink))) as { state: string; target: string; runs: RunReport[] };
  assert.equal(own.state, "verified");
  assert.equal(own.target, "opfs");
  assert.deepEqual(await readMigrationRuns(sink), own.runs);
  assert.equal(writesOff({ state: own.state as "verified", target: "opfs" }), true);
});
