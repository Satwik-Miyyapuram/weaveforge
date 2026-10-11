import { test } from "node:test";
import assert from "node:assert/strict";

import { markActions, markPopoverShown } from "../mark-actions";

test("a mark with a comment offers Edit comment, prefilled", () => {
  assert.deepEqual(markActions({ type: "highlight", origin: "local", comment: "key claim" }), {
    kind: "Highlight",
    colour: true,
    comment: "Edit comment",
    prefill: "key claim",
  });
});

test("a mark without one offers Comment, empty", () => {
  const kinds = { highlight: "Highlight", underline: "Underline", note: "Comment", image: "Clip" } as const;
  for (const type of ["highlight", "underline", "note", "image"] as const) {
    assert.deepEqual(markActions({ type, origin: "local", comment: "  " }), {
      kind: kinds[type],
      colour: true,
      comment: "Comment",
      prefill: "",
    });
  }
});

test("a text box offers delete only", () => {
  assert.deepEqual(markActions({ type: "text", origin: "local", comment: "" }), {
    kind: "Text box",
    colour: false,
    comment: null,
    prefill: "",
  });
});

test("ink, placed pictures and Zotero marks get no popover", () => {
  assert.equal(markActions({ type: "ink", origin: "local", comment: "" }), null);
  assert.equal(markActions({ type: "highlight", origin: "zotero", comment: "" }), null);
  const picture = "![picture](p/1.png)";
  assert.equal(markActions({ type: "image", origin: "local", comment: picture }), null);
});

test("a text box's popover shows under Select or Text only", () => {
  assert.equal(markPopoverShown({ type: "text" }, "select"), true);
  assert.equal(markPopoverShown({ type: "text" }, "text"), true);
  assert.equal(markPopoverShown({ type: "text" }, "highlight"), false);
  assert.equal(markPopoverShown({ type: "highlight" }, "highlight"), true);
});
