import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// H3: following a project rename copies the old folder into the new name and never removes or
// renames the source. The reader's old folder is the only copy until they have checked the new one,
// so a rename that fails half way must leave both folders whole.

const source = readFileSync(new URL("../application/parts-3.ts", import.meta.url), "utf8");

function body(name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} is defined in parts-3.ts`);
  return source.slice(start, source.indexOf("\n}\n", start));
}

test("followProjectRename never removes or renames the old folder", () => {
  const rename = body("followProjectRename") + body("copyIfAbsent");
  assert.equal(rename.includes("fs.remove("), false, "no fs.remove in the rename path");
  assert.equal(rename.includes("fs.rename("), false, "no fs.rename in the rename path");
});

test("the rename copies bytes, so binary files survive the copy", () => {
  const copy = body("copyIfAbsent");
  assert.ok(copy.includes("fs.readFile("), "the copy reads bytes, not text");
  assert.equal(copy.includes("fs.readText("), false, "no text read that would mangle binary files");
});
