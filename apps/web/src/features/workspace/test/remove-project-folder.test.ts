import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryWorkspaceFs } from "@weaveforge/core/testing";

import { removeProjectFolder } from "../application/remove-project-folder";

const project = { id: "ac0e9a12-0000-4000-8000-000000000000", name: "ZZ verify 082" };

test("removes the project's folder and nothing else", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("zz-verify-082--ac0e9a/notes/a.md", "x");
  await fs.writeFile("thesis--2a3407/notes/b.md", "y");
  assert.equal(await removeProjectFolder(fs, project), "zz-verify-082--ac0e9a");
  assert.equal(await fs.stat("zz-verify-082--ac0e9a/notes/a.md"), null);
  assert.notEqual(await fs.stat("thesis--2a3407/notes/b.md"), null);
});

test("finds a folder named before a rename by its id suffix", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("old-name--ac0e9a/a.md", "x");
  assert.equal(await removeProjectFolder(fs, project), "old-name--ac0e9a");
  assert.equal(await fs.stat("old-name--ac0e9a/a.md"), null);
});

test("leaves everything when no folder matches", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("thesis--2a3407/a.md", "x");
  assert.equal(await removeProjectFolder(fs, project), null);
  assert.notEqual(await fs.stat("thesis--2a3407/a.md"), null);
});
