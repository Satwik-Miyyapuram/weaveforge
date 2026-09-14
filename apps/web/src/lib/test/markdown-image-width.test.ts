import { test } from "node:test";
import assert from "node:assert/strict";

import { parseImageAlt, setImagePlacement, setImageWidth, withImageWidth } from "../markdown-image-width";

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

test("setImagePlacement replaces a placement, it does not stack beside it", () => {
  const body = "![photo right c=0,0,10,10|40%](x.png)";
  // A new side replaces the old one; the crop and width it did not mention
  // are kept, because one click is one idea.
  assert.equal(
    setImagePlacement(body, "photo", 0, { align: "left" }),
    "![photo left c=0,0,10,10|40%](x.png)",
  );
  // A new crop replaces the insets and keeps the rest.
  assert.equal(
    setImagePlacement(body, "photo", 0, { crop: [5, 5, 5, 5] }),
    "![photo right c=5,5,5,5|40%](x.png)",
  );
  // Reset clears all three.
  assert.equal(
    setImagePlacement(body, "photo", 0, { align: null, crop: null, width: null }),
    "![photo](x.png)",
  );
});
