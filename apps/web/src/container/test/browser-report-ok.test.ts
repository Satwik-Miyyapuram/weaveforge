/**
 * browserReportOk, run end to end over a fake OPFS folder shaped like BrowserWorkspaceFs: list(dir)
 * returns stat objects, not paths. It must reach the report through reportFolderSink, so a
 * verified report reads as true; a raw pass-through would read no runs and stay false.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkspaceStat } from "@weaveforge/core";
import { browserReportOk } from "@/container/browser-file-backend";
import { INSTALL_ID_PATH } from "@/container/browser-install-id";
import { MIGRATION_KINDS, REPORT_PATH, type RunReport } from "@/features/migration-097/domain/report";

// readOrCreateInstallId runs under navigator.locks; the node runner has none.
Object.defineProperty(globalThis, "navigator", {
  value: { locks: { request: (_name: string, fn: () => unknown) => Promise.resolve().then(fn) } },
  configurable: true,
});

const INSTALL_ID = "browser-install-1";
const KIND_OK = { db: 1, files: 1, written: 1, conflicts: [], trash: 0 };
const RUN: RunReport = {
  startedAt: "2026-11-22T00:00:00.000Z",
  finishedAt: "2026-11-22T00:01:00.000Z",
  sources: ["postgrest"],
  kinds: Object.fromEntries(MIGRATION_KINDS.map((k) => [k, KIND_OK])),
  blobs: { db: 1, verified: 1 },
  missing: [],
  state: "verified",
  target: "opfs",
  deviceId: INSTALL_ID,
};

/** An OPFS-like folder: files in a map, list(dir) answers with stat objects like BrowserWorkspaceFs. */
function opfsFolder(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const missing = () => Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
  return {
    async list(dir: string): Promise<readonly WorkspaceStat[]> {
      const stats: WorkspaceStat[] = [];
      for (const path of store.keys()) {
        if (path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes("/")) {
          stats.push({ path, size: 0, modifiedAt: RUN.finishedAt, kind: "file" });
        }
      }
      return stats;
    },
    async readText(path: string): Promise<string> {
      const value = store.get(path);
      if (value === undefined) throw missing();
      return value;
    },
    async writeFile(path: string, data: string): Promise<void> {
      store.set(path, data);
    },
    async rename(from: string, to: string): Promise<void> {
      const value = store.get(from);
      if (value === undefined) throw missing();
      store.set(to, value);
      store.delete(from);
    },
  };
}

test("browserReportOk: true when this install's OPFS report is a verified run (through the report folder adapter)", async () => {
  const report = { version: 1, state: "verified", backup: null, verifiedAt: RUN.finishedAt, target: "opfs", runs: [RUN] };
  const fs = opfsFolder({ [INSTALL_ID_PATH]: INSTALL_ID, [REPORT_PATH]: JSON.stringify(report) });
  assert.equal(await browserReportOk(async () => fs), true);
});

test("browserReportOk: false when the OPFS folder has no report for this install", async () => {
  const fs = opfsFolder({ [INSTALL_ID_PATH]: INSTALL_ID });
  assert.equal(await browserReportOk(async () => fs), false);
});
