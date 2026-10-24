import assert from "node:assert/strict";
import test from "node:test";
import { MemoryWorkspaceFs } from "../../src/testing/memory-workspace-fs.js";

async function walked(fs: MemoryWorkspaceFs, dir = ""): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of fs.walk(dir)) out.push(entry.path);
  return out;
}

test("walk yields paths in path order, whatever the files hold (08-05)", async () => {
  const fs = new MemoryWorkspaceFs();
  // A space sorts below the comma an array's string form puts after the path,
  // so sorting [path, bytes] pairs put "a b" first.
  await fs.writeFile("a b", "2");
  await fs.writeFile("a", "1");
  await fs.writeFile("a!", "3");

  assert.deepEqual(await walked(fs), ["a", "a b", "a!"]);
});

test("walk under a folder keeps the same order and nothing outside it (08-05)", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("d/z.md", "z");
  await fs.writeFile("d/a b.md", "x");
  await fs.writeFile("d/a.md", "y");
  await fs.writeFile("e/a.md", "outside");

  assert.deepEqual(await walked(fs, "d"), ["d/a b.md", "d/a.md", "d/z.md"]);
});
