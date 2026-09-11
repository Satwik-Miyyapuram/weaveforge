import { test } from "node:test";
import assert from "node:assert/strict";

import { parseImageAlt, setImageWidth, withImageWidth } from "../markdown-image-width";

test("a `|NN%` suffix is a width; a bare alt is not", () => {
  assert.deepEqual(parseImageAlt("Figure 1|40%"), { alt: "Figure 1", width: "40%" });
  assert.deepEqual(parseImageAlt("Figure 1|300"), { alt: "Figure 1", width: "300px" });
  assert.deepEqual(parseImageAlt("Figure 1"), { alt: "Figure 1" });
  // Over 100% is capped: a picture cannot be wider than its column.
  assert.equal(parseImageAlt("x|140%").width, "100%");
});

test("withImageWidth writes and clears the suffix", () => {
  assert.equal(withImageWidth("Figure 1", "40%"), "Figure 1|40%");
  assert.equal(withImageWidth("Figure 1|40%", "60%"), "Figure 1|60%");
  assert.equal(withImageWidth("Figure 1|40%", null), "Figure 1");
});

test("setImageWidth rewrites the nth image with that alt and nothing else", () => {
  const body = ["![a](one.png)", "![b](two.png)", "![a](three.png)"].join("\n");
  const out = setImageWidth(body, "a", 1, "50%");
  assert.equal(out, ["![a](one.png)", "![b](two.png)", "![a|50%](three.png)"].join("\n"));
  // Clearing puts the bare alt back.
  assert.equal(setImageWidth(out, "a", 1, null), body);
  // An ordinal past the last match leaves the body alone.
  assert.equal(setImageWidth(body, "a", 5, "50%"), body);
});
