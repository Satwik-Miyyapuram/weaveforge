import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseMdImageAlt,
  withMdImageAlt,
} from "../markdown-figure-alt";

test("a plain alt is all description", () => {
  assert.deepEqual(parseMdImageAlt("Figure 1"), { alt: "Figure 1" });
});

test("the width suffix is a width, cropped alts keep theirs", () => {
  assert.deepEqual(parseMdImageAlt("Figure 1|40%"), {
    alt: "Figure 1",
    width: "40%",
  });
  assert.deepEqual(parseMdImageAlt("Figure 1|300"), {
    alt: "Figure 1",
    width: "300px",
  });
  assert.equal(parseMdImageAlt("x|140%").width, "100%");
});

test("a crop is four insets, percentages of the image's own box", () => {
  assert.deepEqual(parseMdImageAlt("photo c=0,0,10,10"), {
    alt: "photo",
    crop: [0, 0, 10, 10],
  });
  assert.deepEqual(parseMdImageAlt("photo c=1,2,3,4|60%"), {
    alt: "photo",
    crop: [1, 2, 3, 4],
    width: "60%",
  });
  // Clamped: a crop inset cannot take the whole edge off.
  assert.deepEqual(parseMdImageAlt("photo c=150,0,0,0"), {
    alt: "photo",
    crop: [99, 0, 0, 0],
  });
  // Three numbers are not a crop; they stay text.
  assert.deepEqual(parseMdImageAlt("photo c=1,2,3"), { alt: "photo c=1,2,3" });
});

test("an alignment word at the end is a placement, inside text it is not", () => {
  assert.deepEqual(parseMdImageAlt("photo right"), { alt: "photo", align: "right" });
  assert.deepEqual(parseMdImageAlt("photo left|50%"), {
    alt: "photo",
    align: "left",
    width: "50%",
  });
  // `right` inside a phrase is description, not placement.
  assert.deepEqual(parseMdImageAlt("the right answer"), {
    alt: "the right answer",
  });
});

test("all three together", () => {
  assert.deepEqual(parseMdImageAlt("photo right c=0,0,10,10|60%"), {
    alt: "photo",
    align: "right",
    crop: [0, 0, 10, 10],
    width: "60%",
  });
});

test("withMdImageAlt writes what parseMdImageAlt reads", () => {
  assert.equal(withMdImageAlt("photo", { align: "right", crop: [0, 0, 10, 10], width: "60%" }), "photo right c=0,0,10,10|60%");
  // Clearing each piece writes it back off.
  assert.equal(withMdImageAlt("photo", { crop: null, align: null, width: null }), "photo");
  // The width keeps its Obsidian spelling, capped like the reader.
  assert.equal(withMdImageAlt("photo", { width: "140%" }), "photo|100%");
  // What is written is what is read.
  assert.deepEqual(
    parseMdImageAlt(
      withMdImageAlt("photo", { align: "center", crop: [1, 2, 3, 4] }),
    ),
    { alt: "photo", align: "center", crop: [1, 2, 3, 4] },
  );
});
