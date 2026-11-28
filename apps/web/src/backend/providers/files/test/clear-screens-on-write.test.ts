import { test } from "node:test";
import assert from "node:assert/strict";
import type { IWorkspaceFs } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { clearScreensOnWrite } from "../clear-screens-on-write";

test("a conditional write that appears after wiring is still there, and clears the screens", async () => {
  // The no-account folder: its conditional write exists only once a folder is open.
  let open: MemoryWorkspaceFs | null = null;
  const late = new Proxy({} as IWorkspaceFs, {
    get: (_, key) => {
      if (key === "writeTextIf") return open ? open.writeTextIf.bind(open) : undefined;
      const fs = open ?? new MemoryWorkspaceFs();
      const value = (fs as unknown as Record<PropertyKey, unknown>)[key];
      return typeof value === "function" ? value.bind(fs) : value;
    },
  });
  let cleared = 0;
  const fs = clearScreensOnWrite(late, () => cleared++);
  // Read through a call: a property check would narrow it for the rest of the test.
  const writeOf = () => fs.writeTextIf;
  assert.ok(!writeOf(), "no folder open: no conditional write");

  open = new MemoryWorkspaceFs();
  const write = writeOf();
  assert.ok(write, "the folder's conditional write is offered once it opens");
  assert.equal(await write("a.md", "one", null), true);
  assert.equal(await open.readText("a.md"), "one");
  assert.equal(cleared, 1);
});
