import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ReaderAnnotation } from "@weaveforge/core";
import {
  draftPicture,
  pagePictures,
  pictureComment,
  pictureMeta,
  picturePath,
  pictureRect,
} from "../reader-picture";

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

  it("reads and writes a picture's crop and stacking order", () => {
    const comment = pictureComment({ path: "p/1.png", crop: [10, 0, 5, 20], z: 2 });
    assert.equal(comment, "![picture c=10,0,5,20 z=2](p/1.png)");
    assert.deepEqual(pictureMeta({ type: "image", comment }), {
      path: "p/1.png",
      crop: [10, 0, 5, 20],
      z: 2,
    });
    assert.equal(picturePath({ type: "image", comment }), "p/1.png");
    // The plain form, and a crop cleared back to nothing, stay the plain form.
    assert.equal(pictureComment({ path: "p/1.png", crop: [0, 0, 0, 0], z: 0 }), "![picture](p/1.png)");
  });

  it("turns a page's pictures into figures, y-down, in paint order", () => {
    const ann = (id: string, comment: string, rect: number[]) =>
      ({
        id,
        type: "image",
        comment,
        anchor: { zoteroPosition: { pageIndex: 0, rects: [rect] } },
      }) as unknown as ReaderAnnotation;
    const list = pagePictures(
      [
        ann("a", "![picture z=1](a.png)", [100, 500, 300, 700]),
        ann("b", "![picture](b.png)", [0, 0, 50, 50]),
        ann("c", "a clip", [0, 0, 10, 10]),
      ],
      800,
    );
    assert.deepEqual(
      list.map((one) => one.id),
      ["b", "a"],
    );
    assert.deepEqual(list[1]!.figure, { path: "a.png", x: 100, y: 100, w: 200, h: 200 });
    assert.deepEqual(pictureRect(list[1]!.figure, 800), [100, 500, 300, 700]);
  });
});
