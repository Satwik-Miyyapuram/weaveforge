// Source-match guards for sharing UI edge cases: failed list reloads and a stale kind filter.
// Each assert pins one fix so a refactor cannot silently drop it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../ui/share-link-panel.tsx", import.meta.url), "utf8");
const shared = readFileSync(new URL("../ui/shared-with-me-screen.tsx", import.meta.url), "utf8");

test("share link panel surfaces a failed list reload instead of an unhandled rejection", () => {
  assert.match(panel, /reload\(\)\.catch\(\(e: unknown\) => setError\(formatError\(e\)\)\);/);
});

test("share link panel reloads after create in its own try, not the create try", () => {
  assert.match(panel, /setCreatedUrl\(url\);\n\s*\} catch \(e\) \{\n\s*setError\(formatError\(e\)\);\n\s*setBusy\(false\);\n\s*return;\n\s*\}/);
  assert.match(panel, /\/\/ Own try: a reload failure after a created link is not a create failure\.\n\s*try \{\n\s*await reload\(\);/);
});

test("shared-with-me falls back to all when the filtered kind disappears", () => {
  assert.match(shared, /const activeKind = kindFilter !== "all" && !kinds\.includes\(kindFilter\) \? "all" : kindFilter;/);
  assert.match(shared, /value=\{activeKind\}/);
});

test("shared-with-me groups and empty state use the filtered items", () => {
  assert.match(shared, /for \(const it of visibleItems\)/);
  assert.match(shared, /\{!error && visibleItems\.length === 0 && \(/);
});
