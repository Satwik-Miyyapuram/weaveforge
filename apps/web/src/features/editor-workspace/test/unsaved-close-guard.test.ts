/**
 * Closing the window warns while a save is running, and also after a save
 * failed: the text is then only in memory, and closing would lose it. Typing
 * and ink still waiting on their debounce count too: they are not saved yet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { closeWouldLoseWork } from "../ui/workspace-screen-support";

const screen = readFileSync(new URL("../ui/workspace-screen.tsx", import.meta.url), "utf8");
const idle = { pending: 0, dirty: false, inkPending: 0, bodyPending: false };

test("nothing waiting: the window closes without a prompt", () => {
  assert.equal(closeWouldLoseWork(idle), false);
});

test("a running save, a failed one, debounced ink or debounced typing each hold the close", () => {
  assert.equal(closeWouldLoseWork({ ...idle, pending: 1 }), true);
  assert.equal(closeWouldLoseWork({ ...idle, dirty: true }), true);
  assert.equal(closeWouldLoseWork({ ...idle, inkPending: 1 }), true);
  assert.equal(closeWouldLoseWork({ ...idle, bodyPending: true }), true);
});

test("the guard asks the helper with the ink status and the body savers", () => {
  assert.match(screen, /closeWouldLoseWork\(\{/);
  assert.match(screen, /inkPending: getInkSaveStatus\(\)\.pending/);
  assert.match(screen, /bodyPending: hasPendingBodySave\(\)/);
  assert.match(screen, /dirtyRef\.current = dirty;/);
});
