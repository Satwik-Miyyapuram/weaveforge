import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// H2: a renamed non-canvas entry is applied to the database under its new title. The file the
// reader renamed is the only copy of their edit until the mirror writes the note at its new path,
// so applyEntries must never remove it. A duplicate is acceptable; loss is not.

const source = readFileSync(new URL("../application/parts-1.ts", import.meta.url), "utf8");

test("applyEntries never removes the renamed source file", () => {
  const start = source.indexOf("export async function applyEntries(");
  assert.ok(start >= 0, "applyEntries is defined in parts-1.ts");
  const body = source.slice(start, source.indexOf("\n}\n", start));
  assert.equal(body.includes("fs.remove("), false, "no fs.remove in applyEntries");
});
