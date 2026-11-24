import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { scopedWorkspaceFs } from "../scoped-workspace-fs";

test("a scoped fs reads and writes inside its folder, with paths relative to it", async () => {
  const base = new MemoryWorkspaceFs();
  const fs = scopedWorkspaceFs(base, "thesis--abc123");
  await fs.mkdirp("notes");
  await fs.writeFile("notes/a.md", "A");
  assert.equal(await base.readText("thesis--abc123/notes/a.md"), "A");
  assert.deepEqual((await fs.list("")).map((s) => s.path), ["notes"]);
  const walked: string[] = [];
  for await (const s of fs.walk("")) walked.push(s.path);
  assert.ok(walked.includes("notes/a.md"));
  assert.equal((await fs.stat("notes/a.md"))?.path, "notes/a.md");
  await fs.rename("notes/a.md", "notes/b.md");
  assert.equal(await base.readText("thesis--abc123/notes/b.md"), "A");
  await fs.remove("notes/b.md");
  assert.equal(await base.stat("thesis--abc123/notes/b.md"), null);
  assert.equal(Boolean(fs.writeTextIf), Boolean(base.writeTextIf));
});

test("no folder is the workspace itself", () => {
  const base = new MemoryWorkspaceFs();
  assert.equal(scopedWorkspaceFs(base, ""), base);
});
