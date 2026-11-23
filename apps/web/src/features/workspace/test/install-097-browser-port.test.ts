/**
 * The per-device install-097 check for a browser or Android WebView. Old data here is the install id
 * 0.9.7 wrote when its in-browser export started; exported here is the 0.9.7 completion flag or a
 * verified 0.9.7 report in this browser's workspace (its own, or another 0.9.7 report in the same folder;
 * GitHub sync never brings one, the folder is git-ignored). Only this device's storage is read: no account, no server.
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

const verified = JSON.stringify({ version: 1, state: "verified", backup: null, runs: [] });
const incomplete = JSON.stringify({ version: 1, state: "incomplete", backup: null, runs: [] });

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
    listPaths: async (dir: string) => Object.keys(files).filter((p) => p.startsWith(`${dir}/`)),
  };
}

const noFlag = () => null;

async function verdict(files: Record<string, string | Error>, readFlag: (key: string) => string | null = noFlag) {
  const fs = fakeFs(files);
  const port = createBrowserOldDataPort({ readText: fs.readText, listPaths: fs.listPaths, readFlag });
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
  const { verdict: v } = await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(OTHER)]: incomplete });
  assert.deepEqual(v, { kind: "unverified", action: "web-export" });
});

test("second browser: old data here and another install's verified 0.9.7 report is in this browser's folder: open", async () => {
  const { verdict: v } = await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(OTHER)]: verified });
  assert.deepEqual(v, { kind: "open" });
});

test("a verified legacy report.json in this workspace counts as exported: open", async () => {
  const { verdict: v } = await verdict({ [INSTALL_ID_PATH]: ID, [LEGACY_REPORT_PATH]: verified });
  assert.deepEqual(v, { kind: "open" });
});

test("files in the report folder that are not reports are ignored", async () => {
  const { verdict: v } = await verdict({ [INSTALL_ID_PATH]: ID, [`${REPORT_DIR}/notes.json`]: verified });
  assert.deepEqual(v, { kind: "unverified", action: "web-export" });
});

test("report names follow the 0.9.7 reader: a sync copy counts, a .bad file set aside does not", async () => {
  const copy = `${REPORT_DIR}/report-${OTHER} (1).json`;
  assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: ID, [copy]: verified })).verdict, { kind: "open" });
  const bad = `${REPORT_DIR}/report-${OTHER}.json.bad`;
  assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: ID, [bad]: verified })).verdict, {
    kind: "unverified",
    action: "web-export",
  });
});

test("own report incomplete, an unreadable sibling and a verified sibling: open in either listing order", async () => {
  const bad = LEGACY_REPORT_PATH;
  const good = ownReportPath(OTHER);
  for (const order of [[bad, good], [good, bad]]) {
    const files: Record<string, string | Error> = { [INSTALL_ID_PATH]: ID, [ownReportPath(ID)]: incomplete };
    for (const p of order) files[p] = p === bad ? "{not json" : verified;
    assert.deepEqual((await verdict(files)).verdict, { kind: "open" });
  }
});

test("an unreadable report and no verified one: open (cannot tell)", async () => {
  const { verdict: v } = await verdict({
    [INSTALL_ID_PATH]: ID,
    [ownReportPath(ID)]: incomplete,
    [ownReportPath(OTHER)]: "{not json",
  });
  assert.deepEqual(v, { kind: "open" });
});

test("old data here and this device's own report is verified: open", async () => {
  const { verdict: v, reads } = await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(ID)]: verified });
  assert.deepEqual(v, { kind: "open" });
  assert.ok(reads.includes(ownReportPath(ID)), "the own report is the one read");
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
  assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: ID, [ownReportPath(ID)]: verified }, throwing)).verdict, { kind: "open" });
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

test("a sibling report listed but gone when read (list/read race) counts as absent, not as unreadable", async () => {
  const gone = Object.assign(new Error("gone"), { name: "NotFoundError" });
  const sibling = `${REPORT_DIR}/report-${OTHER}.json`;
  assert.deepEqual((await verdict({ [INSTALL_ID_PATH]: ID, [sibling]: gone })).verdict, {
    kind: "unverified",
    action: "web-export",
  });
  assert.deepEqual(
    (await verdict({ [INSTALL_ID_PATH]: ID, [sibling]: gone, [LEGACY_REPORT_PATH]: verified })).verdict,
    { kind: "open" },
  );
});