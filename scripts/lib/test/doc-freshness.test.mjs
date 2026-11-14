import assert from "node:assert/strict";
import { test } from "node:test";

import { frontMatter, pageWarnings } from "../doc-freshness.mjs";

test("frontMatter reads covers and checked", () => {
  const md = `---
covers:
  - apps/web/src/features/reader
  - crates/wf-core/src/reader
checked: 2026-11-14
---
# Reader
`;
  assert.deepEqual(frontMatter(md), {
    covers: ["apps/web/src/features/reader", "crates/wf-core/src/reader"],
    checked: "2026-11-14",
  });
});

test("frontMatter returns null without a front matter block", () => {
  assert.equal(frontMatter("# Reader\n---\n"), null);
});

const exists = (dir) => dir !== "gone";

test("pageWarnings is quiet when the page was checked after the code changed", () => {
  const meta = { covers: ["a", "b"], checked: "2026-11-14" };
  assert.deepEqual(pageWarnings(meta, { exists, lastChange: () => "2026-11-14" }), []);
});

test("pageWarnings names the newest change after the check date", () => {
  const meta = { covers: ["a", "b"], checked: "2026-11-01" };
  const lastChange = (dir) => (dir === "a" ? "2026-11-03" : "2026-11-09");
  assert.deepEqual(pageWarnings(meta, { exists, lastChange }), [
    "b changed on 2026-11-09, after this page was checked on 2026-11-01. Reread the page, fix what moved, and set checked: to today.",
  ]);
});

test("pageWarnings flags missing front matter, a bad date and a covered path that is gone", () => {
  const io = { exists, lastChange: () => null };
  assert.deepEqual(pageWarnings(null, io), ["no covers:/checked: front matter. Say which code this page describes."]);
  assert.deepEqual(pageWarnings({ covers: ["gone"], checked: "14 Nov" }, io), [
    "checked: must be a YYYY-MM-DD date, not 14 Nov.",
    "covers: gone does not exist.",
  ]);
  assert.deepEqual(pageWarnings({ covers: [], checked: "2026-11-14" }, io), ["covers: lists no paths."]);
});
