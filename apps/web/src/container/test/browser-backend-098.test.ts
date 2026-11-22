import assert from "node:assert/strict";
import { test } from "node:test";

import { browserReportVerified, MIGRATION_KINDS, REPORT_PATH } from "@/features/migration-097/domain/report";
import { chooseBrowserBackend } from "../browser-backend-098";

/** A folder that holds only what the test puts in it; any other path is absent. */
function reportFs(text: string | null) {
  return {
    async list(): Promise<string[]> {
      return text === null ? [] : [REPORT_PATH];
    },
    async readText(path: string): Promise<string> {
      if (path !== REPORT_PATH || text === null) throw new Error(`no file: ${path}`);
      return text;
    },
  };
}

/** This browser install's id, as the export writes it on each run. */
const OWN = "web-a";

test("browser report is verified only when opfs, verified and no run misses a row", async () => {
  const ok = JSON.stringify({ state: "verified", target: "opfs", runs: [{ deviceId: OWN, kinds: Object.fromEntries(MIGRATION_KINDS.map((k) => [k, { db: 0, files: 0, written: 0, conflicts: [], trash: 0 }])), blobs: { db: 0, verified: 0 }, missing: [], state: "verified", target: "opfs" }] });
  assert.equal(await browserReportVerified(reportFs(ok), OWN), true);
  const missing = JSON.stringify({ state: "verified", target: "opfs", runs: [{ deviceId: OWN, missing: ["p-1"] }] });
  assert.equal(await browserReportVerified(reportFs(missing), OWN), false);
});

test("zip-only or absent export keeps writes on PostgREST (no report file)", async () => {
  assert.equal(await browserReportVerified(reportFs(null)), false);
});

test("incomplete or folder-target report keeps writes on PostgREST", async () => {
  const incomplete = JSON.stringify({ state: "incomplete", target: "opfs", runs: [{ missing: [] }] });
  assert.equal(await browserReportVerified(reportFs(incomplete)), false);
  const folder = JSON.stringify({ state: "verified", target: "folder", runs: [{ missing: [] }] });
  assert.equal(await browserReportVerified(reportFs(folder)), false);
});

const verified = () => true;
const notVerified = () => false;

test("a fresh install (no legacy data) reaches files, without reading any report", () => {
  let asked = 0;
  assert.equal(
    chooseBrowserBackend(false, () => {
      asked += 1;
      return false;
    }),
    "files",
  );
  assert.equal(asked, 0);
});

test("legacy data present with no verified OPFS report: export first", () => {
  assert.equal(chooseBrowserBackend(true, notVerified), "export-first");
});

test("legacy data present with a verified OPFS report: files", () => {
  assert.equal(chooseBrowserBackend(true, verified), "files");
});

test("unknown legacy state fails closed to export first, even with a verified report", () => {
  assert.equal(chooseBrowserBackend("unknown", verified), "export-first");
  assert.equal(chooseBrowserBackend("unknown", notVerified), "export-first");
});

/** A clean run in the shape the export writes: every kind a known migration kind, no missing rows. */
const cleanRun = {
  deviceId: OWN,
  kinds: Object.fromEntries(MIGRATION_KINDS.map((k) => [k, { db: 0, files: 0, written: 0, conflicts: [], trash: 0 }])),
  blobs: { db: 0, verified: 0 },
  missing: [],
  state: "verified",
  target: "opfs",
};
const verifiedReport = (runs: unknown) => JSON.stringify({ state: "verified", target: "opfs", runs });

test("a hand-edited report with a clean run and known kinds is verified", async () => {
  assert.equal(await browserReportVerified(reportFs(verifiedReport([cleanRun])), OWN), true);
});

test("a hand-edited report with an unknown kind is not verified", async () => {
  const run = { deviceId: OWN, kinds: { notAKind: { db: 1, files: 1, written: 1, conflicts: [], trash: 0 } }, missing: [] };
  assert.equal(await browserReportVerified(reportFs(verifiedReport([run])), OWN), false);
});

test("a hand-edited report whose runs is not a list is not verified, and does not throw", async () => {
  const text = JSON.stringify({ state: "verified", target: "opfs", runs: "none" });
  assert.equal(await browserReportVerified(reportFs(text)), false);
});

test("a hand-edited run without a missing list is not verified, and does not throw", async () => {
  assert.equal(await browserReportVerified(reportFs(verifiedReport([{ kinds: cleanRun.kinds }]))), false);
});

test("a hand-edited run without a kinds object is not verified", async () => {
  assert.equal(await browserReportVerified(reportFs(verifiedReport([{ missing: [] }]))), false);
});

test("a hand-edited run that lists a missing row is not verified", async () => {
  const run = { ...cleanRun, missing: [{ kind: "notes", id: "n-1", reason: "x" }] };
  assert.equal(await browserReportVerified(reportFs(verifiedReport([run]))), false);
});

test("the chooser asks the report only when legacy data is present", () => {
  let asked = 0;
  chooseBrowserBackend("unknown", () => {
    asked += 1;
    return true;
  });
  assert.equal(asked, 0, "unknown legacy state must not read the OPFS report");
});
