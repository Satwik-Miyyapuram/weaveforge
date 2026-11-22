import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkspaceStat } from "@weaveforge/core";
import { reportFolderSink } from "../infrastructure/report-folder-sink";
import { MIGRATION_KINDS, REPORT_DIR, REPORT_PATH, ownReportPath, browserReportVerified } from "../domain/report";

const KIND_OK = { db: 0, files: 0, written: 0, conflicts: [], trash: 0 };

/**
 * A folder shaped like BrowserWorkspaceFs: list(dir) returns children as `${dir}/${name}` with kind file or dir,
 * and [] when the folder does not exist; readText throws for a missing path.
 */
function folderWith(files: Record<string, string>) {
  return {
    async list(dir: string): Promise<readonly WorkspaceStat[]> {
      const prefix = `${dir}/`;
      const children = new Map<string, WorkspaceStat>();
      for (const path of Object.keys(files)) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash === -1) {
          children.set(path, { path, size: (files[path] ?? "").length, modifiedAt: "", kind: "file" });
        } else {
          const dirPath = `${prefix}${rest.slice(0, slash)}`;
          children.set(dirPath, { path: dirPath, size: 0, modifiedAt: "", kind: "dir" });
        }
      }
      return [...children.values()];
    },
    async readText(path: string): Promise<string> {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
  };
}

const VERIFIED_OPFS_REPORT = JSON.stringify({
  version: 1,
  state: "verified",
  backup: null,
  target: "opfs",
  runs: [
    {
      startedAt: "2026-11-22T00:00:00.000Z",
      finishedAt: "2026-11-22T00:01:00.000Z",
      sources: ["postgrest"],
      kinds: Object.fromEntries(MIGRATION_KINDS.map((k) => [k, KIND_OK])),
      blobs: { db: 0, verified: 0 },
      missing: [],
      state: "verified",
      target: "opfs",
      deviceId: "web-a",
    },
  ],
});

test("reportFolderSink.list: returns only the report files directly under REPORT_DIR, as full paths", async () => {
  const sink = reportFolderSink(
    folderWith({
      [REPORT_PATH]: "{}",
      [ownReportPath("web-a")]: "{}",
      [`${REPORT_DIR}/nested/report-x.json`]: "{}",
      [".weaveforge/local/install-id"]: "web-a",
    }),
  );
  assert.deepEqual((await sink.list()).sort(), [REPORT_PATH, ownReportPath("web-a")].sort());
});

test("reportFolderSink.list: an absent report folder lists nothing", async () => {
  assert.deepEqual(await reportFolderSink(folderWith({})).list(), []);
});

test("reportFolderSink.readText: reads the file at the same path list gave", async () => {
  const sink = reportFolderSink(folderWith({ [REPORT_PATH]: "legacy" }));
  assert.equal(await sink.readText(REPORT_PATH), "legacy");
});

test("browserReportOk path: a verified OPFS report in the folder is read as verified", async () => {
  const folder = folderWith({ [ownReportPath("web-a")]: VERIFIED_OPFS_REPORT });
  assert.equal(await browserReportVerified(reportFolderSink(folder), "web-a"), true);
});

test("browserReportOk path: an absent report folder is not verified and never throws", async () => {
  assert.equal(await browserReportVerified(reportFolderSink(folderWith({})), "web-a"), false);
});
