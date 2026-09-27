import { test } from "node:test";
import assert from "node:assert/strict";

import { setImagePlacement, withImageWidth } from "../markdown-image-width";

test("withImageWidth writes and clears the suffix", () => {
  assert.equal(withImageWidth("Figure 1", "40%"), "Figure 1|40%");
  assert.equal(withImageWidth("Figure 1|40%", "60%"), "Figure 1|60%");
  assert.equal(withImageWidth("Figure 1|40%", null), "Figure 1");
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
