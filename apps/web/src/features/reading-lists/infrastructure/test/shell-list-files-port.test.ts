import assert from "node:assert/strict";
import test, { before } from "node:test";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { WorkspaceListFilesPort } from "../shell-list-files-port";

before(async () => {
  await loadTestCore();
});

const LIST = "---\nwf: 3\ntitle: Review\n---\nWhy.\n";

async function setup(files: Record<string, string>) {
  const fs = new MemoryWorkspaceFs();
  for (const [path, text] of Object.entries(files)) await fs.writeFile(path, text);
  return { fs, port: new WorkspaceListFilesPort(fs, "thesis") };
}

test("listFiles returns every .list.md under reading-lists and ignores other files", async () => {
  const { port } = await setup({
    "thesis/reading-lists/a.list.md": LIST,
    "thesis/reading-lists/sub/b.list.md": LIST,
    "thesis/reading-lists/notes.md": "not a list",
    "thesis/reading-lists/readme.txt": "text",
    "thesis/other/c.list.md": LIST,
  });
  const paths = (await port.listFiles()).map((f) => f.path).sort();
  assert.deepEqual(paths, ["thesis/reading-lists/a.list.md", "thesis/reading-lists/sub/b.list.md"]);
});

test("listFiles returns [] when the reading-lists folder does not exist", async () => {
  const { port } = await setup({ "thesis/notes/x.md": "x" });
  assert.deepEqual(await port.listFiles(), []);
});

test("a malformed list file is still returned by listFiles", async () => {
  const broken = "this is not a list file";
  const { port } = await setup({ "thesis/reading-lists/bad.list.md": broken });
  const files = await port.listFiles();
  assert.equal(files.length, 1);
  assert.equal(files[0]!.text, broken);
});

test("write with a stale expectedHash throws and leaves the file unchanged", async () => {
  const { fs, port } = await setup({ "thesis/reading-lists/a.list.md": LIST });
  const [before] = await port.listFiles();
  const changed = "---\nwf: 3\ntitle: Changed elsewhere\n---\n";
  await fs.writeFile("thesis/reading-lists/a.list.md", changed);
  await assert.rejects(
    port.write("thesis/reading-lists/a.list.md", "mine", before!.hash),
    /list file changed on disk; not overwritten: thesis\/reading-lists\/a\.list\.md/,
  );
  assert.equal(await fs.readText("thesis/reading-lists/a.list.md"), changed);
});

test("write with the current hash succeeds and the hash changes", async () => {
  const { fs, port } = await setup({ "thesis/reading-lists/a.list.md": LIST });
  const [before] = await port.listFiles();
  const next = "---\nwf: 3\ntitle: Updated\n---\n";
  await port.write("thesis/reading-lists/a.list.md", next, before!.hash);
  assert.equal(await fs.readText("thesis/reading-lists/a.list.md"), next);
  const [after] = await port.listFiles();
  assert.notEqual(after!.hash, before!.hash);
});

test("fileForItem returns null when no list holds the item", async () => {
  const { port } = await setup({ "thesis/reading-lists/a.list.md": LIST });
  assert.equal(await port.fileForItem("i1"), null);
});
