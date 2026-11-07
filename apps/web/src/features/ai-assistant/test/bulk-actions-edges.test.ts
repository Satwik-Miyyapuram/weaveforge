/**
 * Bulk review edges: a failed bulk run must reset busy and show its error, bulk
 * approve must follow the visible list, reload must keep the list on screen,
 * and a failed page refresh after an approve must not read as a failed approve.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../ui/ai-proposal-review-screen.tsx", import.meta.url)), "utf8");

test("bulk run resets busy in finally and shows errors", () => {
  assert.match(src, /setBusy\("all"\);\n      try \{\n/);
  assert.match(src, /\} catch \(err\) \{ setError\(formatError\(err\)\); \}\n      finally \{ setBusy\(null\); \}\n    \}\)\(\)\);/);
});

test("bulk approve only touches the visible list", () => {
  assert.match(src, /const appendOnly = visible\.filter\(\(item\) => item\.kind === "append_paper_note"\);/);
  assert.doesNotMatch(src, /items\.filter\(\(item\) => item\.kind === "append_paper_note"\)/);
});

test("reload keeps current items on screen instead of showing a loader", () => {
  assert.doesNotMatch(src, /const reload = useCallback\(async \(\) => \{\n    setLoading\(true\);/);
});

test("failed page refresh after approve is reported softly", () => {
  assert.match(src, /refreshFailed = true;/);
  assert.match(src, /else if \(refreshFailed\) setError\("Approved, but the page list could not refresh\."\);/);
});
