/**
 * The note editor keeps its own copy of the body, so a chip's × must change
 * that copy too; changing only the saved body would be undone by the next
 * autosave, and the #tag would come back.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { bodyWithoutTag } from "../tag-editor-body";

function fakeEditor(text: string) {
  return { text: () => text, replaceAll(next: string) { text = next; } };
}

test("a chip removes its hashtag from the live editor text, unsaved edits kept", () => {
  const editor = fakeEditor("Saved #cv and an unsaved line #ml");
  const body = bodyWithoutTag("cv", editor, "Saved #cv");
  assert.equal(editor.text(), body);
  assert.doesNotMatch(body, /#cv/);
  assert.match(body, /unsaved line #ml/);
});

test("without an editor (Read, Ink) the saved body is used", () => {
  assert.doesNotMatch(bodyWithoutTag("cv", null, "Saved #cv"), /#cv/);
});
