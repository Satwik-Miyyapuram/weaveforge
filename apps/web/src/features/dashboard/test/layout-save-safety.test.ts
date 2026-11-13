/**
 * The dashboard must never save a layout the user did not make. When the saved
 * layout fails to load, the screen shows the default; an edit then must not
 * write that default over the real one. Undo of "Reset layout" is an edit and
 * saves, and an edit made just before leaving the page still saves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const screen = readFileSync(fileURLToPath(new URL("../ui/dashboard-screen.tsx", import.meta.url)), "utf8");

test("a failed layout load blocks saving over the stored layout", () => {
  const failed = screen.slice(screen.indexOf("} catch (err) {", screen.indexOf("getLayout(projectId)")));
  assert.match(failed.slice(0, 300), /layoutLoadFailed\.current = true/);
  assert.match(screen, /layoutLoadFailed\.current = false;\s*\n\s*const stored = await getContainer\(\)\.dashboard\.getLayout/);
  assert.match(screen, /if \(!projectId \|\| !layoutReady\.current \|\| layoutLoadFailed\.current \|\|/);
});

test("undoing a reset marks the layout dirty so it saves", () => {
  assert.match(screen, /run: \(\) => \{ markDirty\(\); setLayout\(before\); \}/);
});

test("a pending save is flushed when the screen unmounts", () => {
  assert.match(screen, /useEffect\(\(\) => \(\) => pendingSave\.current\?\.\(\), \[\]\)/);
});
