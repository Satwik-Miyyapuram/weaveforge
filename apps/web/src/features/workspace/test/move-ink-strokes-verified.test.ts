import assert from "node:assert/strict";
import { before, test } from "node:test";

import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

import { moveInkStrokes } from "../application/parts-1";

// A renamed note's stroke page is removed from the old folder only once its copy at
// the new place holds the same bytes. A failed or short copy keeps the source.

let core: RustCore;
before(async () => {
  core = await loadTestCore();
});

const AT = "2026-08-05T00:00:00.000Z";
const PAGE = new Uint8Array([1, 2, 3, 4]);

async function setup() {
  const fs = new MemoryWorkspaceFs(() => AT);
  const root = core.projectDir({ id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" });
  const from = `${root}/notes/Method.note.md`;
  const to = `${root}/notes/Methods.note.md`;
  const src = `${core.inkStrokesDir(from)}/01J.inkb`;
  const dest = `${core.inkStrokesDir(to)}/01J.inkb`;
  await fs.mkdirp(core.inkStrokesDir(from));
  await fs.writeFile(src, PAGE);
  return { fs, from, to, src, dest };
}

test("a copy that fails keeps the source page", async () => {
  const { fs, from, to, src, dest } = await setup();
  const write = fs.writeFile.bind(fs);
  fs.writeFile = async (path: string, data: Uint8Array | string) => {
    if (path === dest) throw new Error("ENOSPC");
    return write(path, data);
  };

  await assert.rejects(moveInkStrokes(fs, from, to), /ENOSPC/);

  assert.deepEqual([...(await fs.readFile(src))], [...PAGE]);
});

test("a copy that lands short keeps the source page", async () => {
  const { fs, from, to, src, dest } = await setup();
  const write = fs.writeFile.bind(fs);
  // The write reports success but only part of the bytes reach the disk.
  fs.writeFile = async (path: string, data: Uint8Array | string) =>
    write(path, path === dest && typeof data !== "string" ? data.slice(0, 2) : data);

  await moveInkStrokes(fs, from, to);

  assert.deepEqual([...(await fs.readFile(src))], [...PAGE]);
});

test("a different page already at the new place keeps both pages", async () => {
  const { fs, from, to, src, dest } = await setup();
  await fs.mkdirp(core.inkStrokesDir(to));
  await fs.writeFile(dest, new Uint8Array([9]));

  await moveInkStrokes(fs, from, to);

  assert.deepEqual([...(await fs.readFile(dest))], [9], "the page at the new place is kept as it is");
  assert.deepEqual([...(await fs.readFile(src))], [...PAGE], "the source is not lost");
});

test("a verified copy removes the source page", async () => {
  const { fs, from, to, src, dest } = await setup();

  await moveInkStrokes(fs, from, to);

  assert.deepEqual([...(await fs.readFile(dest))], [...PAGE]);
  assert.equal(await fs.stat(src), null);
});
