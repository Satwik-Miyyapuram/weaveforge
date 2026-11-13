import { test } from "node:test";
import assert from "node:assert/strict";
import { readyCore } from "@/lib/rust-core";

test("stripUnresolvedImageRefs: drops only the refs with no URL", () => {
  const body = "![a](paperimg:a.png) and ![b](paperimg:b.png)";
  const out = readyCore().stripUnresolvedImageRefs(body, "paperimg:", ["a.png", "b.png"], ["a.png"]);
  assert.equal(out, "![a](paperimg:a.png) and ");
});

test("stripUnresolvedImageRefs: a path with regex metacharacters is matched literally", () => {
  const body = "![x](reportimg:a+b(1).png)";
  const out = readyCore().stripUnresolvedImageRefs(body, "reportimg:", ["a+b(1).png"], []);
  assert.equal(out, "");
});