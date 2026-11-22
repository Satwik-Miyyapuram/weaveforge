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
