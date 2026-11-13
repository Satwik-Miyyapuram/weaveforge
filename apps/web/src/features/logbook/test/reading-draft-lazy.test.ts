/**
 * "Draft from today's reading" needs the papers feature. A static import ships
 * the whole papers barrel with /log and breaks the bundle budget (WF-P07). It
 * must load only when the button is used.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui");

test("log entry form loads the reading draft on demand, not statically", () => {
  const source = readFileSync(path.join(uiDir, "add-log-entry-form.tsx"), "utf8");
  assert.doesNotMatch(source, /^import[^;]*features\/papers/m);
  assert.match(source, /^\s+import\("@\/features\/papers"\)/m);
});
