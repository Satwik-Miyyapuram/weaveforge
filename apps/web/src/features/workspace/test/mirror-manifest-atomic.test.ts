import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { IWorkspaceFs } from "@weaveforge/core";

import { writeTextAtomic } from "../application/parts-3";

// M3: the mirror manifest is read on every sync. A plain writeFile truncates it first, so a crash or
// a lock mid-write leaves a torn manifest, and the next run re-learns every path wrongly. The
// manifest must be written the same way the canvas id map is: temp file, then rename.

// writeTextAtomic only touches writeFile, rename and remove. A small map-backed fake keeps this test
// free of the wasm core that MemoryWorkspaceFs needs for path checks.
function mapFs() {
  const files = new Map<string, string>();
  const finalWrites: string[] = [];
  const fs = {
    files,
    finalWrites,
    async writeFile(path: string, data: string) {
      if (path.endsWith(".tmp") === false) finalWrites.push(path);
      files.set(path, data);
    },
    async rename(from: string, to: string) {
      const data = files.get(from);
      if (data === undefined) throw new Error(`missing ${from}`);
      files.delete(from);
      files.set(to, data);
    },
    async remove(path: string) {
      files.delete(path);
    },
  };
  return fs;
}

const MANIFEST = "projects/thesis--abc123/.weaveforge/mirror.json";

test("writeTextAtomic writes through a temp file and leaves none behind", async () => {
  const fs = mapFs();
  fs.files.set(MANIFEST, "old manifest");
  await writeTextAtomic(fs as unknown as IWorkspaceFs, MANIFEST, "new manifest, complete");

  assert.deepEqual(fs.finalWrites, [], "the live manifest is never written in place when rename works");
  assert.equal(fs.files.get(MANIFEST), "new manifest, complete");
  assert.equal(fs.files.has(`${MANIFEST}.tmp`), false, "no temp file left after success");
});

test("writeMirrorManifest writes the manifest atomically", () => {
  const source = readFileSync(new URL("../application/parts-3.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function writeMirrorManifest(");
  assert.ok(start >= 0, "writeMirrorManifest is defined in parts-3.ts");
  const body = source.slice(start, source.indexOf("\n}\n", start));
  assert.equal(body.includes("fs.writeFile(file, next)"), false, "no plain in-place write of the manifest");
  assert.ok(body.includes("writeTextAtomic(fs, file, next)"), "the manifest goes through writeTextAtomic");
});
