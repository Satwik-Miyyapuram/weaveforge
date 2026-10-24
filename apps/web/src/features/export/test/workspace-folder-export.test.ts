/**
 * The markdown folder export (B64).
 *
 * - 27-01: a report figure the section links to ends up in the zip.
 * - 27-08: the zip-to-blob step is shared and round-trips.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { emptyWorkspaceSnapshot } from "@weaveforge/core/testing";
import { buildWorkspaceFolderFiles } from "../application/export-user-data";
import { zipToBlob } from "@/lib/blob-output";

const PROJECT = { id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" };
const blob = (text: string) => ({ arrayBuffer: async () => new TextEncoder().encode(text).buffer }) as Blob;

function snapshot() {
  return emptyWorkspaceSnapshot({
    reportSections: [
      { id: "s1", title: "Results", sectionNo: "1", status: "draft", notes: "![](reportimg:u/s1/plot.png)" } as never,
    ],
    vaultPages: [{ id: "n1", title: "Method", body: "![](vault:u/n1/d.png)" } as never],
  });
}

function readers(calls: Record<string, readonly string[]>, missing = false) {
  const reader = (name: string, text: string) => async (paths: readonly string[]) => {
    calls[name] = paths;
    return new Map(paths.map((p) => [p, missing ? null : blob(text)]));
  };
  return {
    fetchVaultAssets: reader("vault", "note-bytes"),
    fetchPaperImages: reader("papers", "paper-bytes"),
    fetchReportImages: reader("report", "report-bytes"),
  };
}

test("a report figure ends up in the folder export (27-01)", async () => {
  const calls: Record<string, readonly string[]> = {};
  const files = await buildWorkspaceFolderFiles(snapshot(), PROJECT, readers(calls));
  assert.deepEqual(calls.report, ["u/s1/plot.png"]);
  const key = Object.keys(files).find((k) => k.endsWith("plot.png"));
  assert.ok(key, "report figure missing from the export");
  assert.equal(strFromU8(files[key]!), "report-bytes");
  assert.ok(Object.keys(files).some((k) => k.endsWith("d.png")), "note asset still exported");
  assert.equal(calls.papers, undefined, "no paper fetch when nothing references one");
});

test("a report figure that cannot be fetched is skipped", async () => {
  const files = await buildWorkspaceFolderFiles(snapshot(), PROJECT, readers({}, true));
  assert.equal(Object.keys(files).find((k) => k.endsWith("plot.png")), undefined);
  assert.ok(Object.keys(files).some((k) => k.endsWith(".md")));
});

test("zipToBlob makes a zip blob holding the given files (27-08)", async () => {
  const out = zipToBlob({ "a/b.txt": new TextEncoder().encode("hi") });
  assert.equal(out.type, "application/zip");
  const back = unzipSync(new Uint8Array(await out.arrayBuffer()));
  assert.equal(strFromU8(back["a/b.txt"]!), "hi");
});

test("zipToBlob of no files is still a valid empty zip", async () => {
  const back = unzipSync(new Uint8Array(await zipToBlob({}).arrayBuffer()));
  assert.deepEqual(Object.keys(back), []);
});
