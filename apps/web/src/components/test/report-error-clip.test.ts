import assert from "node:assert/strict";
import { test } from "node:test";

import { clipText, HEADINGS, PAGE_TITLE } from "@/components/report-error-button";

test("clipText never splits a surrogate pair (13-16)", () => {
  const text = "a".repeat(56) + "😀😀😀😀😀";
  const clipped = clipText(text, 60);
  assert.equal(clipped, "a".repeat(56) + "😀…");
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(clipped), "no lone high surrogate");
});

test("clipText leaves text at or under the limit alone, counting code points", () => {
  assert.equal(clipText("short", 60), "short");
  assert.equal(clipText("😀".repeat(60), 60), "😀".repeat(60));
  assert.equal(clipText("x".repeat(61), 60), "x".repeat(57) + "…");
  assert.equal(clipText("", 60), "");
});

test("the report trail skips headings inside rendered markdown", () => {
  for (const selector of [...HEADINGS.split(","), ...PAGE_TITLE.split(",")]) {
    const s = selector.trim();
    if (/^(main )?h\d/.test(s)) assert.match(s, /:not\(\.markdown \*\)$/, s);
  }
});
