/**
 * The per-device install-097 check for a browser or Android WebView. Old data here is the install id
 * 0.9.7 wrote when its in-browser export started. Exported here is the 0.9.7 completion flag, or this
 * device's own report (`report-<installId>.json`) with a verified run of this device. Other devices'
 * reports and the legacy `report.json` do not count, matching migrate.rs `report_state_verified`.
 * Only this device's storage is read: no account, no server.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { install097Check } from "../application/install-097-guard";
import {
  createBrowserOldDataPort,
  INSTALL_ID_PATH,
  LEGACY_REPORT_PATH,
  REPORT_DIR,
  WEB_EXPORTED_KEY,
  ownReportPath,
} from "../infrastructure/install-097-browser-port";

const ID = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
const OTHER = "9f0c5a1e-0000-4000-8000-000000000001";

/** One run of a device, shaped like the 0.9.7 writer's runs. Complete unless a field says otherwise. */
function run(deviceId: string, state = "verified", startedAt = "2026-11-20T10:00:00Z", extra: object = {}) {
  return { deviceId, state, startedAt, missing: [], kinds: { vault_page: { db: 2, files: 2 } }, ...extra };
}

/** A 0.9.7 report file with the given top-level state and runs. */
function report(state: string, runs: object[]): string {
  return JSON.stringify({ version: 1, state, backup: null, runs });
}

/** This device's report: verified, with one complete verified run of `id`. */
const verified = (id: string) => report("verified", [run(id)]);
const incomplete = report("incomplete", [run(ID, "incomplete")]);

/** A fake OPFS: `files` maps a path to its text, or to an Error the read throws. Records every read. */
function fakeFs(files: Record<string, string | Error>) {
  const reads: string[] = [];
  return {
    reads,
    readText: async (path: string) => {
      reads.push(path);
      const value = files[path];
      if (value === undefined) throw new Error(`ENOENT: ${path}`);
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

const noFlag = () => null;

async function verdict(files: Record<string, string | Error>, readFlag: (key: string) => string | null = noFlag) {
  const fs = fakeFs(files);
  const port = createBrowserOldDataPort({ readText: fs.readText, readFlag });
  return { verdict: await install097Check(null, null, port), reads: fs.reads };
}

test("no old data: no 0.9.7 install id in this browser opens, and no report is read", async () => {
  const { verdict: v, reads } = await verdict({});
  assert.deepEqual(v, { kind: "open" });
  assert.deepEqual(reads, [INSTALL_ID_PATH]);
});

test("second browser: old data here and no report at all: Install 0.9.7 first", async () => {
  const { verdict: v } = await verdict({ [INSTALL_ID_PATH]: `${ID}\n` });
  assert.deepEqual(v, { kind: "unverified", action: "web-export" });
});

test("second browser: old data here and only another device's incomplete report in the folder: Install 0.9.7 first", async () => {
  const { verdict: v } = await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(OTHER)]: report("incomplete", [run(OTHER, "incomplete")]) });
  assert.deepEqual(v, { kind: "unverified", action: "web-export" });
});

test("another device's verified report in this browser's folder does not count, and is never read", async () => {
  const { verdict: v, reads } = await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(OTHER)]: verified(OTHER) });
  assert.deepEqual(v, { kind: "unverified", action: "web-export" });
  assert.ok(!reads.includes(ownReportPath(OTHER)), "the other device's report is not read");
});

test("a verified legacy report.json does not count: Install 0.9.7 first", async () => {
  const { verdict: v } = await verdict({ [INSTALL_ID_PATH]: ID, [LEGACY_REPORT_PATH]: verified(ID) });
  assert.deepEqual(v, { kind: "unverified", action: "web-export" });
});

test("files in the report folder that are not this device's report are ignored", async () => {
  const { verdict: v } = await verdict({ [INSTALL_ID_PATH]: ID, [`${REPORT_DIR}/notes.json`]: verified(ID) });
  assert.deepEqual(v, { kind: "unverified", action: "web-export" });
});

test("only the exact report-<installId>.json name counts: a sync copy of this device or another's .bad file does not", async () => {
  const ownCopy = `${REPORT_DIR}/report-${ID} (1).json`;
  assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: ID, [ownCopy]: verified(ID) })).verdict, {
    kind: "unverified",
    action: "web-export",
  });
  const otherCopy = `${REPORT_DIR}/report-${OTHER} (1).json`;
  assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: ID, [otherCopy]: verified(OTHER) })).verdict, {
    kind: "unverified",
    action: "web-export",
  });
  const bad = `${REPORT_DIR}/report-${ID}.json.bad`;
  assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: ID, [bad]: verified(ID) })).verdict, {
    kind: "unverified",
    action: "web-export",
  });
});

test("own report incomplete with other devices' and legacy reports unreadable or verified: still unverified, none of them read", async () => {
  const files: Record<string, string | Error> = {
    [INSTALL_ID_PATH]: ID,
    [ownReportPath(ID)]: incomplete,
    [LEGACY_REPORT_PATH]: "{not json",
    [ownReportPath(OTHER)]: verified(OTHER),
  };
  const { verdict: v, reads } = await verdict(files);
  assert.deepEqual(v, { kind: "unverified", action: "web-export" });
  assert.ok(!reads.includes(LEGACY_REPORT_PATH) && !reads.includes(ownReportPath(OTHER)));
});

test("old data here and this device's own report is verified: open", async () => {
  const { verdict: v, reads } = await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(ID)]: verified(ID) });
  assert.deepEqual(v, { kind: "open" });
  assert.ok(reads.includes(ownReportPath(ID)), "the own report is the one read");
});

test("own report removing or removed, with a verified run of this device: open", async () => {
  for (const state of ["removing", "removed"]) {
    const body = report(state, [run(ID)]);
    assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(ID)]: body })).verdict, { kind: "open" }, state);
  }
});

test("own report verified but with no run of this device is not proof: Install 0.9.7 first", async () => {
  const { verdict: v } = await verdict({
    [INSTALL_ID_PATH]: ID,
    [ownReportPath(ID)]: report("verified", [run(OTHER)]),
  });
  assert.deepEqual(v, { kind: "unverified", action: "web-export" });
});

test("this device's newest run is incomplete, even after an older verified one: Install 0.9.7 first", async () => {
  const body = report("verified", [run(ID, "verified", "2026-11-19T10:00:00Z"), run(ID, "incomplete", "2026-11-20T10:00:00Z")]);
  assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(ID)]: body })).verdict, {
    kind: "unverified",
    action: "web-export",
  });
});

test("a verified run with a missing item or a db/files count mismatch is not complete: Install 0.9.7 first", async () => {
  const missing = report("verified", [run(ID, "verified", undefined, { missing: ["vault_page"] })]);
  const mismatch = report("verified", [run(ID, "verified", undefined, { kinds: { vault_page: { db: 2, files: 1 } } })]);
  for (const body of [missing, mismatch]) {
    assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(ID)]: body })).verdict, {
      kind: "unverified",
      action: "web-export",
    });
  }
});

test("old data here and this device's own report is incomplete: Install 0.9.7 first", async () => {
  const { verdict: v } = await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(ID)]: incomplete });
  assert.deepEqual(v, { kind: "unverified", action: "web-export" });
});

test("old data here and the 0.9.7 completion flag is set in this browser: open", async () => {
  const { verdict: v } = await verdict({ [INSTALL_ID_PATH]: ID }, (key) => (key === WEB_EXPORTED_KEY ? "1" : null));
  assert.deepEqual(v, { kind: "open" });
});

test("a flag read that throws is not decisive: the own report still decides", async () => {
  const throwing = () => {
    throw new Error("storage blocked");
  };
  assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: ID }, throwing)).verdict, { kind: "unverified", action: "web-export" });
  assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(ID)]: verified(ID) }, throwing)).verdict, { kind: "open" });
});

test("throw: the install id read fails with anything but not-found: open (fail open)", async () => {
  const { verdict: v } = await verdict({ [INSTALL_ID_PATH]: new Error("NotReadableError") });
  assert.deepEqual(v, { kind: "open" });
});

test("throw: the own report read fails with anything but not-found: open (fail open)", async () => {
  const { verdict: v } = await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(ID)]: new Error("NotReadableError") });
  assert.deepEqual(v, { kind: "open" });
});

test("unreadable data: a malformed install id or a report that is not a report opens (cannot tell)", async () => {
  assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: "../../x" })).verdict, { kind: "open" });
  assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(ID)]: "{not json" })).verdict, { kind: "open" });
  assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(ID)]: "[]" })).verdict, { kind: "open" });
  assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(ID)]: '{"state":"odd"}' })).verdict, { kind: "open" });
});

test("a not-found error in the NotFoundError shape counts as absent, not as a throw", async () => {
  const notFound = Object.assign(new Error("gone"), { name: "NotFoundError" });
  assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: notFound })).verdict, { kind: "open" });
  assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(ID)]: notFound })).verdict, {
    kind: "unverified",
    action: "web-export",
  });
});

test("the browser port reads no account and no server", () => {
  const src = readFileSync(fileURLToPath(new URL("../infrastructure/install-097-browser-port.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /supabase|profiles|fetch\(|getDataClient|\.from\(|\.rpc\(/);
});

test("the gate asks only the browser port: no signed-in or server reader is wired", () => {
  const src = readFileSync(fileURLToPath(new URL("../ui/install-097-gate.tsx", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /signed-in-port|supabase-reads|install-097-web-port/);
  assert.match(src, /install-097-browser-port/);
});
