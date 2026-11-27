/**
 * The folder copy of extracted PDF text is reconciled at launch and before
 * every index build. It used to read and parse every paper's file just to learn
 * which papers the folder holds; the file name already says that. Only files
 * IndexedDB lacks are read now.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { PdfIndexSource } from "@weaveforge/wasm";
import { loadTestCore } from "@/lib/test/load-test-core";
import { reconcilePdfTextFolder } from "../application/parts-1";
import { folderCacheDir } from "../infrastructure/vector-store";

before(loadTestCore);

const source = (paperId: string): PdfIndexSource =>
  ({ paperId, pages: [{ page: 1, text: `text of ${paperId}` }] }) as unknown as PdfIndexSource;

async function setup(folderIds: string[], ownIds: string[]) {
  const fs = new MemoryWorkspaceFs();
  const dir = `${folderCacheDir()}/pdf-text/p1`;
  for (const id of folderIds) await fs.writeFile(`${dir}/${encodeURIComponent(id)}.json`, JSON.stringify(source(id)));
  const reads: string[] = [];
  const readText = fs.readText.bind(fs);
  fs.readText = (path: string) => {
    reads.push(path);
    return readText(path);
  };
  const saved: string[] = [];
  const deps = {
    fs,
    load: async () => ownIds.map(source),
    save: async (_: string | null, s: PdfIndexSource) => void saved.push(s.paperId),
  };
  return { fs, dir, reads, saved, deps };
}

test("only the files IndexedDB lacks are read", async () => {
  const { reads, saved, deps, dir } = await setup(["a", "b", "c/d"], ["a", "b"]);
  await reconcilePdfTextFolder("p1", deps);
  assert.deepEqual(reads, [`${dir}/${encodeURIComponent("c/d")}.json`]);
  assert.deepEqual(saved, ["c/d"]);
});

test("text only IndexedDB has still goes to the folder", async () => {
  const { fs, dir, saved, deps } = await setup(["a"], ["a", "z"]);
  await reconcilePdfTextFolder("p1", deps);
  assert.deepEqual(saved, []);
  assert.equal(JSON.parse(await fs.readText(`${dir}/z.json`)).paperId, "z");
});

test("an unreadable folder file costs one paper, not the rest", async () => {
  const { fs, dir, saved, deps } = await setup(["b"], []);
  await fs.writeFile(`${dir}/a.json`, "{not json");
  await fs.writeFile(`${dir}/%E0%A4%A.json`, "{}");
  await reconcilePdfTextFolder("p1", deps);
  assert.deepEqual(saved, ["b"]);
});
