/**
 * Closing the window warns while a save is running, and also after a save
 * failed: the text is then only in memory, and closing would lose it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const screen = readFileSync(new URL("../ui/workspace-screen.tsx", import.meta.url), "utf8");

test("the close guard also holds while the document is dirty", () => {
  assert.match(screen, /if \(pendingRef\.current <= 0 && !dirtyRef\.current\) return;/);
  assert.match(screen, /dirtyRef\.current = dirty;/);
});
