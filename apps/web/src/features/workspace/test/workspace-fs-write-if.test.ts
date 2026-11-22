/**
 * Every workspace fs adapter can write only if the file is unchanged (F97-P2-6).
 *
 * The note, milestone, paper and annotation repos refuse to save without
 * `writeTextIf`, so an adapter that lacks it turns every save into an error.
 * This pins the contract on each adapter the app ships, and on the test double.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";

import { BrowserWorkspaceFs, DesktopWorkspaceFs } from "../infrastructure/parts";

test("F97-P2-6: every workspace fs adapter implements writeTextIf", () => {
  for (const adapter of [BrowserWorkspaceFs, DesktopWorkspaceFs, MemoryWorkspaceFs]) {
    assert.equal(typeof adapter.prototype.writeTextIf, "function", `${adapter.name} lacks writeTextIf`);
  }
});

test("F97-P2-6: the test double's writeTextIf writes only when the file still holds the expected text", async () => {
  const fs = new MemoryWorkspaceFs();
  // Absent file: expected null means "create it".
  assert.equal(await fs.writeTextIf("note.md", "one", null), true);
  // Stale expectation is refused and the file keeps its text.
  assert.equal(await fs.writeTextIf("note.md", "stale", null), false);
  assert.equal(await fs.readText("note.md"), "one");
  // Matching expectation writes.
  assert.equal(await fs.writeTextIf("note.md", "two", "one"), true);
  assert.equal(await fs.readText("note.md"), "two");
});
