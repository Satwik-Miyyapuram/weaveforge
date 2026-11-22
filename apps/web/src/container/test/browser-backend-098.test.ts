import assert from "node:assert/strict";
import { test } from "node:test";

import { browserReportVerified, REPORT_PATH } from "@/features/migration-097/domain/report";
import { chooseBrowserBackend, reportIsVerifiedOpfs } from "../browser-backend-098";

/** A folder that holds only what the test puts in it; any other path is absent. */
function reportFs(text: string | null) {
  return {
    async readText(path: string): Promise<string> {
      if (path !== REPORT_PATH || text === null) throw new Error(`no file: ${path}`);
      return text;
    },
  };
}

test("browser report is verified only when opfs, verified and no run misses a row", async () => {
  const ok = JSON.stringify({ state: "verified", target: "opfs", runs: [{ missing: [] }] });
  assert.equal(await browserReportVerified(reportFs(ok)), true);
  const missing = JSON.stringify({ state: "verified", target: "opfs", runs: [{ missing: ["p-1"] }] });
  assert.equal(await browserReportVerified(reportFs(missing)), false);
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

test("verified means state verified, target opfs and an empty missing list", () => {
  assert.equal(reportIsVerifiedOpfs({ state: "verified", target: "opfs", missing: [] }), true);
  assert.equal(reportIsVerifiedOpfs({ state: "verified", target: "opfs", missing: ["notes"] }), false);
  assert.equal(reportIsVerifiedOpfs({ state: "verified", target: "opfs" }), false);
  assert.equal(reportIsVerifiedOpfs({ state: "verified", target: "folder", missing: [] }), false);
  assert.equal(reportIsVerifiedOpfs({ state: "incomplete", target: "opfs", missing: [] }), false);
  assert.equal(reportIsVerifiedOpfs(null), false);
  assert.equal(reportIsVerifiedOpfs("verified"), false);
});
