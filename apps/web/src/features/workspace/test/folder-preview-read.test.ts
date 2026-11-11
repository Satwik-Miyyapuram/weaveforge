/**
 * What a folder preview reads (B65).
 *
 * - 29-15: it walks only this project, the shared assets and, in a legacy flat
 *   folder, the rest; never `.git` or another project's folder.
 * - 29-16: an asset over the size cap is skipped on its listed size, before
 *   its bytes are read.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { MemoryWorkspaceFs } from "@weaveforge/core/testing";

import { IMPORT_LIMITS, readPreviewFolder, SKIP_TOO_BIG } from "../application/parts-2";

const ROOT = "thesis--abc123";

async function folder(files: Record<string, string>): Promise<MemoryWorkspaceFs> {
  const fs = new MemoryWorkspaceFs();
  for (const [path, body] of Object.entries(files)) await fs.writeFile(path, body);
  return fs;
}

/** Records every directory walked and every file read. */
function spy(fs: MemoryWorkspaceFs) {
  const walked: string[] = [];
  const read: string[] = [];
  const walk = fs.walk.bind(fs);
  const readFile = fs.readFile.bind(fs);
  fs.walk = (dir: string) => {
    walked.push(dir);
    return walk(dir);
  };
  fs.readFile = (path: string) => {
    read.push(path);
    return readFile(path);
  };
  return { walked, read };
}

test("a project folder reads its own notes, data and assets", async () => {
  const fs = await folder({
    [`${ROOT}/notes/a.md`]: "# A",
    [`${ROOT}/data/papers.json`]: "[]",
    "assets/x.png": "png",
    "other--zzz999/notes/b.md": "# B",
    "stray.md": "# stray",
  });
  const out = await readPreviewFolder(fs, ROOT, true);
  assert.deepEqual(Object.keys(out.files), [`${ROOT}/notes/a.md`]);
  assert.deepEqual([...out.assets.keys()], ["assets/x.png"]);
});

test("the preview never walks .git or another project (29-15)", async () => {
  const fs = await folder({
    [`${ROOT}/notes/a.md`]: "# A",
    ".git/objects/ab/cdef": "blob",
    ".git/HEAD": "ref",
    "other--zzz999/notes/b.md": "# B",
    ".weaveforge/manifest.json": "{}",
  });
  const { walked } = spy(fs);
  await readPreviewFolder(fs, ROOT, true);
  assert.deepEqual(walked, [ROOT]);
});

test("a legacy flat folder reads its top level but still skips .git", async () => {
  const fs = await folder({
    "notes/a.md": "# A",
    "top.md": "# Top",
    ".git/HEAD": "ref",
    "other--zzz999/notes/b.md": "# B",
    ".weaveforge/x.md": "meta",
    "assets/y.png": "png",
  });
  const { walked } = spy(fs);
  const out = await readPreviewFolder(fs, ROOT, false);
  assert.deepEqual(Object.keys(out.files).sort(), ["notes/a.md", "top.md"]);
  assert.deepEqual([...out.assets.keys()], ["assets/y.png"]);
  assert.ok(!walked.some((dir) => dir === ".git" || dir.startsWith("other--") || dir === ".weaveforge"));
});

test("an oversize asset is skipped without reading it (29-16)", async () => {
  const fs = await folder({ "assets/big.bin": "x", "assets/ok.png": "png" });
  const list = fs.walk.bind(fs);
  fs.walk = async function* (dir: string) {
    for await (const entry of list(dir)) {
      yield entry.path === "assets/big.bin" ? { ...entry, size: IMPORT_LIMITS.maxFileBytes + 1 } : entry;
    }
  };
  const read: string[] = [];
  const readFile = fs.readFile.bind(fs);
  fs.readFile = (path: string) => {
    read.push(path);
    return readFile(path);
  };
  const out = await readPreviewFolder(fs, ROOT, true);
  assert.deepEqual(read, ["assets/ok.png"]);
  assert.deepEqual([...out.assets.keys()], ["assets/ok.png"]);
  assert.deepEqual(out.skipped, [{ path: "assets/big.bin", reason: SKIP_TOO_BIG }]);
});

test("an empty folder reads nothing", async () => {
  const out = await readPreviewFolder(new MemoryWorkspaceFs(), ROOT, false);
  assert.deepEqual(out.skipped, []);
  assert.deepEqual(out.files, {});
  assert.deepEqual(out.jsonFiles, {});
  assert.equal(out.assets.size, 0);
});

test("a preview of some paths reads those notes and only the assets they name", async () => {
  const fs = await folder({
    [`${ROOT}/notes/a.md`]: "# A\n\n![fig](../../assets/vault/fig.png)",
    [`${ROOT}/notes/b.md`]: "# B",
    "assets/vault/fig.png": "png",
    "assets/vault/other.png": "png",
    "assets/vault/dropped.png": "png",
  });
  const { read } = spy(fs);
  const only = new Set([`${ROOT}/notes/a.md`, "assets/vault/dropped.png"]);
  const out = await readPreviewFolder(fs, ROOT, true, only);
  assert.deepEqual(Object.keys(out.files), [`${ROOT}/notes/a.md`]);
  assert.deepEqual([...out.assets.keys()].sort(), ["assets/vault/dropped.png", "assets/vault/fig.png"]);
  assert.ok(!read.includes("assets/vault/other.png"), "an asset no read note names is not read");
});

test("a preview of no paths reads nothing", async () => {
  const fs = await folder({ [`${ROOT}/notes/a.md`]: "# A", "assets/x.png": "png" });
  const out = await readPreviewFolder(fs, ROOT, true, new Set());
  assert.deepEqual(out.files, {});
  assert.equal(out.assets.size, 0);
});
