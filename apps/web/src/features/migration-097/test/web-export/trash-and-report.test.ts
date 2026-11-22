import assert from "node:assert/strict";
import { test } from "node:test";
import { ownReportPath, REPORT_PATH, type RunReport } from "../../domain/report";
import type { FileCodec, Row } from "../../domain/ports";
import { runWebExport } from "../../application/run-web-export";
import { MemorySink } from "../../infrastructure/memory-sink";
import { NOW, fakeCodec, fakeServer, FIXTURE, KINDS, SUPPORTED, fakeDesktop, TRASH_ROW, TRASH_PATH } from "./helpers";

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

  const reportA = JSON.parse(await sink.readText(ownReportPath("dev-a"))) as { backup: string | null; runs: RunReport[] };
  assert.equal(reportA.runs[0]?.backup, "dump-a.zip");
  assert.equal(reportA.backup, "dump-a.zip");
  const reportB = JSON.parse(await sink.readText(ownReportPath("dev-b"))) as { backup: string | null; runs: RunReport[] };
  assert.equal(reportB.runs[0]?.backup, null);
  assert.equal(reportB.backup, null, "device B's file never takes device A's dump");
});

test("refused run: its runs entry carries backup null, not an absent key, when no backup was made", async () => {
  const sink = new MemorySink();
  const calls: string[] = [];
  const result = await runWebExport({ kinds: [], codec: fakeCodec([]), source: fakeServer({ rows: {} }).source, sink, now: NOW, desktop: { folder: "C:/ws", bridge: fakeDesktop(calls, { backupFails: true }) } });
  // No device id is known before a desktop backup succeeds, so the refusal has no file of its own to be written to.
  assert.equal(result.run.backup, null);
  assert.deepEqual(await sink.list(), []);
});

test("report: a legacy report whose runs is not a list refuses the run and is left untouched", async () => {
  const sink = new MemorySink();
  const legacy = JSON.stringify({ version: 1, state: "incomplete", backup: "old.dump", runs: "not-a-list" });
  await sink.write(REPORT_PATH, legacy);
  const result = await runWebExport({ runDeviceId: "dev-x", kinds: [], codec: fakeCodec([]), source: fakeServer({ rows: {} }).source, sink, now: NOW });
  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason === "report unreadable"));
  assert.equal(await sink.readText(REPORT_PATH), legacy, "the unreadable legacy report is never merged over or rewritten");
});
