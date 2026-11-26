import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { writtenWorkspaceFs } from "../written-workspace-fs";

test("each change to the workspace is reported once it is done; reads are not", async () => {
  const base = new MemoryWorkspaceFs();
  let writes = 0;
  const fs = writtenWorkspaceFs(base, () => (writes += 1));
  await fs.mkdirp("notes");
  await fs.writeFile("notes/a.md", "A");
  await fs.rename("notes/a.md", "notes/b.md");
  assert.equal(await fs.writeTextIf!("notes/b.md", "B", "A"), true);
  await fs.remove("notes/b.md");
  assert.equal(writes, 5);
  await fs.readText("notes/.keep").catch(() => undefined);
  await fs.list("notes");
  await fs.stat("notes");
  for await (const _ of fs.walk("")) void _;
  assert.equal(writes, 5);
});

test("a conditional write that did not happen, or a write that failed, is not reported", async () => {
  const base = new MemoryWorkspaceFs();
  await base.writeFile("a.md", "A");
  let writes = 0;
  const fs = writtenWorkspaceFs(base, () => (writes += 1));
  assert.equal(await fs.writeTextIf!("a.md", "B", "not A"), false);
  await assert.rejects(fs.rename("missing.md", "b.md"));
  assert.equal(writes, 0);
  assert.equal(await base.readText("a.md"), "A");
});

test("a workspace without conditional writes stays without them", () => {
  const base = new MemoryWorkspaceFs();
  const plain = { ...base, writeTextIf: undefined } as unknown as MemoryWorkspaceFs;
  assert.equal(writtenWorkspaceFs(plain, () => {}).writeTextIf, undefined);
});
