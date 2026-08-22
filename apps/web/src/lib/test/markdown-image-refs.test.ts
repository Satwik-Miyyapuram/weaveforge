import { test } from "node:test";
import assert from "node:assert/strict";
import { stripUnresolvedImageRefs } from "@/lib/markdown-image-refs";

test("stripUnresolvedImageRefs: drops only the refs with no URL", () => {
  const body = "![a](paperimg:a.png) and ![b](paperimg:b.png)";
  const out = stripUnresolvedImageRefs(body, "paperimg:", ["a.png", "b.png"], new Map([["a.png", "blob:x"]]));
  assert.equal(out, "![a](paperimg:a.png) and ");
});

test("stripUnresolvedImageRefs: a path with regex metacharacters is matched literally", () => {
  const body = "![x](reportimg:a+b(1).png)";
  const out = stripUnresolvedImageRefs(body, "reportimg:", ["a+b(1).png"], new Map());
  assert.equal(out, "");
});
