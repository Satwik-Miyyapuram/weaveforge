import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { draftPicture, picturePath } from "../reader-picture";

describe("reader pictures", () => {
  it("lays a picture half the page wide, centred, at its own shape", () => {
    const draft = draftPicture({ path: "p/1.png", pageIndex: 2, pageWidth: 600, pageHeight: 800, aspect: 2 });
    assert.equal(draft.type, "image");
    assert.equal(draft.pageIndex, 2);
    assert.deepEqual(draft.anchor.zoteroPosition?.rects, [[150, 325, 450, 475]]);
    assert.equal(picturePath({ type: draft.type, comment: draft.comment ?? "" }), "p/1.png");
  });

  it("keeps a tall picture on the page", () => {
    const draft = draftPicture({ path: "t.png", pageIndex: 0, pageWidth: 600, pageHeight: 800, aspect: 0.1 });
    const [x1, y1, x2, y2] = draft.anchor.zoteroPosition!.rects![0] as [number, number, number, number];
    assert.ok(y2 - y1 <= 640 + 1e-9);
    assert.ok(x1 >= 0 && x2 <= 600);
  });

  it("never reads a clip's own words as a picture", () => {
    assert.equal(picturePath({ type: "image", comment: "a figure worth keeping" }), null);
    assert.equal(picturePath({ type: "note", comment: "![picture](p/1.png)" }), null);
  });
});
