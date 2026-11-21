import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";

import { removeProjectFolder } from "../application/parts";

const project = { id: "ac0e9a12-0000-4000-8000-000000000000", name: "ZZ verify 082" };
/** Another project whose id starts with the same six characters, so its folder has the same tail. */
const twin = { id: "ac0e9a99-0000-4000-8000-000000000000", name: "Twin" };

/** Every path under `.weaveforge/trash/`, without the day folder. */
function trashed(fs: MemoryWorkspaceFs): string[] {
  return Object.keys(fs.toRecord())
    .filter((path) => path.startsWith(".weaveforge/trash/"))
    .map((path) => path.split("/").slice(3).join("/"))
    .sort();
}

test("moves the project's folder to the trash and leaves the rest", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("zz-verify-082--ac0e9a/notes/a.md", "x");
  await fs.writeFile("thesis--2a3407/notes/b.md", "y");
  assert.equal(await removeProjectFolder(fs, project), "zz-verify-082--ac0e9a");
  assert.equal(await fs.stat("zz-verify-082--ac0e9a/notes/a.md"), null);
  assert.equal(await fs.stat("zz-verify-082--ac0e9a"), null);
  assert.deepEqual(trashed(fs), ["zz-verify-082--ac0e9a/notes/a.md"]);
  assert.notEqual(await fs.stat("thesis--2a3407/notes/b.md"), null);
});

test("finds a folder named before a rename by its id suffix", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("old-name--ac0e9a/notes/a.md", "x");
  assert.equal(await removeProjectFolder(fs, project), "old-name--ac0e9a");
  assert.equal(await fs.stat("old-name--ac0e9a/notes/a.md"), null);
  assert.deepEqual(trashed(fs), ["old-name--ac0e9a/notes/a.md"]);
});

test("leaves everything when no folder matches", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("thesis--2a3407/notes/a.md", "x");
  assert.equal(await removeProjectFolder(fs, project), null);
  assert.notEqual(await fs.stat("thesis--2a3407/notes/a.md"), null);
});

test("leaves everything when two folders share the id suffix (29-23)", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("one--ac0e9a/notes/a.md", "x");
  await fs.writeFile("two--ac0e9a/notes/b.md", "y");
  assert.equal(await removeProjectFolder(fs, project), null);
  assert.notEqual(await fs.stat("one--ac0e9a/notes/a.md"), null);
  assert.notEqual(await fs.stat("two--ac0e9a/notes/b.md"), null);
});

test("the exact name wins over another folder with the same suffix", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("zz-verify-082--ac0e9a/notes/a.md", "x");
  await fs.writeFile("old-name--ac0e9a/notes/b.md", "y");
  assert.equal(await removeProjectFolder(fs, project), "zz-verify-082--ac0e9a");
  assert.notEqual(await fs.stat("old-name--ac0e9a/notes/b.md"), null);
});

test("F97-P1-1: never takes another project's folder that shares the id tail", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("twin--ac0e9a/notes/b.md", "y");
  assert.equal(await removeProjectFolder(fs, project, [twin]), null);
  assert.notEqual(await fs.stat("twin--ac0e9a/notes/b.md"), null);
  assert.deepEqual(trashed(fs), []);
});

test("F97-P1-1: removing A when B shares its tail trashes A only", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("zz-verify-082--ac0e9a/notes/a.md", "x");
  await fs.writeFile("twin--ac0e9a/notes/b.md", "y");
  assert.equal(await removeProjectFolder(fs, project, [twin]), "zz-verify-082--ac0e9a");
  assert.notEqual(await fs.stat("twin--ac0e9a/notes/b.md"), null);
  assert.deepEqual(trashed(fs), ["zz-verify-082--ac0e9a/notes/a.md"]);
});

test("F97-P1-1: a user folder that only shares the name is never touched", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("holiday--ac0e9a/photo.jpg", "img");
  await fs.writeFile("holiday--ac0e9a/plans/trip.md", "t");
  assert.equal(await removeProjectFolder(fs, project), null);
  assert.notEqual(await fs.stat("holiday--ac0e9a/photo.jpg"), null);
  assert.notEqual(await fs.stat("holiday--ac0e9a/plans/trip.md"), null);
  assert.deepEqual(trashed(fs), []);
});

test("F97-P1-1: a second removal the same day does not overwrite the first in the trash", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("zz-verify-082--ac0e9a/notes/a.md", "first");
  assert.equal(await removeProjectFolder(fs, project), "zz-verify-082--ac0e9a");
  await fs.writeFile("zz-verify-082--ac0e9a/notes/a.md", "second");
  assert.equal(await removeProjectFolder(fs, project), "zz-verify-082--ac0e9a");
  const texts = Object.entries(fs.toRecord())
    .filter(([path]) => path.startsWith(".weaveforge/trash/"))
    .map(([, text]) => text)
    .sort();
  assert.deepEqual(texts, ["first", "second"]);
});
