import assert from "node:assert/strict";
import { test } from "node:test";
import { ownReportPath } from "../../domain/report";
import { runWebExport } from "../../application/run-web-export";
import { MemorySink } from "../../infrastructure/memory-sink";
import { NOW, fakeCodec, fakeServer, FIXTURE, KINDS, SUPPORTED } from "./helpers";

/** A second run must match the first and add no files. */
test("rerun: a second export gives the same report and adds no files", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const exportOnce = () =>
    runWebExport({
      runDeviceId: "dev-test",
      kinds: KINDS,
      codec: fakeCodec(SUPPORTED),
      source,
      sink,
      now: NOW,
    });

  const first = await exportOnce();
  assert.equal(first.state, "verified");
  const filesAfterFirst = (await sink.list()).sort();
  const reportPath = ownReportPath("dev-test");
  const reportAfterFirst = await readReport(sink, reportPath);

  const second = await exportOnce();
  assert.equal(second.state, "verified");
  assert.deepEqual((await sink.list()).sort(), filesAfterFirst, "no new or duplicate files on the rerun");
  // Wall-clock stamps (verifiedAt, finishedAt) differ per run; everything else must match.
  assert.deepEqual(await readReport(sink, reportPath), reportAfterFirst, "the report matches the first run's");
  assert.equal(reportAfterFirst.runs.length, 1, "a device keeps one run entry, not one per rerun");
});

async function readReport(sink: MemorySink, path: string) {
  const report = JSON.parse(await sink.readText(path)) as {
    verifiedAt?: string;
    runs: Array<{ finishedAt?: string }>;
  } & Record<string, unknown>;
  delete report.verifiedAt;
  for (const run of report.runs) delete run.finishedAt;
  return report;
}
