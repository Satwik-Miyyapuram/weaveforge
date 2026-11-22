import assert from "node:assert/strict";
import { test } from "node:test";

import { chooseBrowserBackend, reportIsVerifiedOpfs } from "../browser-backend-098";

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
