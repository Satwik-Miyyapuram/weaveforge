import { test } from "node:test";
import assert from "node:assert/strict";

import { readerPasteImage, type ReaderPasteGate } from "../reader-paste";

const open: ReaderPasteGate = { canCreate: true, ownsFocus: true, editableTarget: false };

function clipboard(...items: { kind: string; type: string; file: File | null }[]) {
  return {
    items: Object.assign(
      items.map((item) => ({ kind: item.kind, type: item.type, getAsFile: () => item.file })),
      { length: items.length },
    ),
  };
}

const png = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
const imagePaste = { defaultPrevented: false, clipboardData: clipboard({ kind: "file", type: "image/png", file: png }) };

test("Ctrl+V of an image in the focused reader answers the image", () => {
  assert.equal(readerPasteImage(imagePaste, open), png);
});

test("a paste with no image on the clipboard is left alone", () => {
  const text = { defaultPrevented: false, clipboardData: clipboard({ kind: "string", type: "text/plain", file: null }) };
  assert.equal(readerPasteImage(text, open), null);
  assert.equal(readerPasteImage({ defaultPrevented: false, clipboardData: null }, open), null);
});

test("a paste the reader does not own is left alone", () => {
  assert.equal(readerPasteImage(imagePaste, { ...open, canCreate: false }), null, "read-only paper");
  assert.equal(readerPasteImage(imagePaste, { ...open, ownsFocus: false }), null, "focus elsewhere");
  assert.equal(readerPasteImage(imagePaste, { ...open, editableTarget: true }), null, "text field");
  assert.equal(readerPasteImage({ ...imagePaste, defaultPrevented: true }, open), null, "already handled");
});
