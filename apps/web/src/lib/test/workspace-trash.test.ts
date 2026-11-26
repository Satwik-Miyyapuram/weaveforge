/**
 * A delete moves a file into `.weaveforge/trash`. A move that fails must not
 * leave the trash name it claimed behind as an empty file.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { claimTrashFolder, moveToTrash } from "../workspace-trash";

before(loadTestCore);

async function files(fs: MemoryWorkspaceFs): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of fs.walk("")) out.push(entry.path);
  return out.sort();
}

test("a rename that throws leaves no trash file and the source in place", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "keep me");
  fs.rename = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(moveToTrash(fs, "notes/a.md", Date.now()), /disk full/);
  assert.deepEqual(await files(fs), ["notes/a.md"]);
  assert.equal(await fs.readText("notes/a.md"), "keep me");
});

test("two same-day deletes of the same path keep both copies", async () => {
  const fs = new MemoryWorkspaceFs();
  const now = Date.now();
  await fs.writeFile("notes/a.md", "first");
  await moveToTrash(fs, "notes/a.md", now);
  await fs.writeFile("notes/a.md", "second");
  await moveToTrash(fs, "notes/a.md", now);
  const all = await files(fs);
  assert.equal(all.length, 2, all.join());
  const texts = await Promise.all(all.map((p) => fs.readText(p)));
  assert.deepEqual(texts.sort(), ["first", "second"]);
});
test("a rename that throws while the source cannot be checked leaves no empty claim", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "keep me");
  const stat = fs.stat.bind(fs);
  fs.rename = async () => {
    throw new Error("disk full");
  };
  fs.stat = async () => {
    throw new Error("io error");
  };
  await assert.rejects(moveToTrash(fs, "notes/a.md", Date.now()), /disk full/);
  fs.stat = stat;
  assert.deepEqual(await files(fs), ["notes/a.md"]);
});

test("a move that lands and then reports a failure keeps the trashed copy", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "keep me");
  const rename = fs.rename.bind(fs);
  fs.rename = async (from, to) => {
    await rename(from, to);
    throw new Error("lost reply");
  };
  await moveToTrash(fs, "notes/a.md", Date.now());
  const all = await files(fs);
  assert.equal(all.length, 1, all.join());
  assert.match(all[0] ?? "", /^\.weaveforge\/trash\//);
});
test("an empty file whose move lands and then reports a failure keeps its trashed copy", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/empty.md", "");
  const rename = fs.rename.bind(fs);
  fs.rename = async (from, to) => {
    await rename(from, to);
    throw new Error("lost reply");
  };
  await moveToTrash(fs, "notes/empty.md", Date.now());
  const all = await files(fs);
  assert.equal(all.length, 1, all.join());
  assert.match(all[0] ?? "", /^\.weaveforge\/trash\//);
  assert.equal(await fs.readText(all[0] ?? ""), "");
});
test("a rename that throws with the source gone keeps the trash name, since it may hold the moved file", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "keep me");
  fs.rename = async (from) => {
    await fs.remove(from);
    throw new Error("source vanished");
  };
  await moveToTrash(fs, "notes/a.md", Date.now());
  const all = await files(fs);
  assert.equal(all.length, 1, all.join());
  assert.match(all[0] ?? "", /^\.weaveforge\/trash\//);
});
test("a folder claim whose marker cannot be removed logs it and still resolves", async () => {
  const fs = new MemoryWorkspaceFs();
  const claim = await claimTrashFolder(fs, "thesis", Date.now());
  fs.remove = async () => {
    throw new Error("locked");
  };
  const warned: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warned.push(args);
  try {
    await claim.release();
  } finally {
    console.warn = warn;
  }
  assert.equal(warned.length, 1);
  assert.match(String(warned[0]?.[0]), /\.claim/);
});
test("two concurrent folder trashes of the same name claim different trash folders", async () => {
  const fs = new MemoryWorkspaceFs();
  const now = Date.now();
  const [a, b] = await Promise.all([claimTrashFolder(fs, "thesis", now), claimTrashFolder(fs, "thesis", now)]);
  assert.notEqual(a.target, b.target);
  await a.release();
  await b.release();
  assert.deepEqual(await files(fs), []);
});