/**
 * The PDF reader's keys (Ctrl+Z for ink, Ctrl+F, Delete) answer while focus is
 * in the reader or in its toolbar, which is portalled out of the reader; and a
 * press on the page takes focus back from whatever toolbar control had it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ownsReaderFocus, pointerFocusTarget } from "../reader-focus";

type Fake = { parent: Fake | null; focusable: boolean; contains(n: Fake): boolean; closest(sel: string): Fake | null };
function node(parent: Fake | null, focusable = false): Fake {
  const n: Fake = {
    parent,
    focusable,
    contains(other) {
      for (let c: Fake | null = other; c; c = c.parent) if (c === n) return true;
      return false;
    },
    closest() {
      for (let c: Fake | null = n; c; c = c.parent) if (c.focusable) return c;
      return null;
    },
  };
  return n;
}

const body = node(null);
const root = node(body, true);
const page = node(root);
const canvas = node(page);
const annotationButton = node(page, true);
const chrome = node(body);
const undo = node(chrome, true);
const elsewhere = node(body, true);

const el = (n: Fake | null) => n as unknown as HTMLElement;

test("focus on nothing, the body, the reader or its toolbar is the reader's", () => {
  const roots = [el(root), el(chrome)];
  assert.equal(ownsReaderFocus(null, el(body), roots), true);
  assert.equal(ownsReaderFocus(el(body), el(body), roots), true);
  assert.equal(ownsReaderFocus(el(canvas), el(body), roots), true);
  assert.equal(ownsReaderFocus(el(undo), el(body), roots), true);
});

test("focus in another pane is not the reader's", () => {
  assert.equal(ownsReaderFocus(el(elsewhere), el(body), [el(root), el(chrome)]), false);
  assert.equal(ownsReaderFocus(el(elsewhere), el(body), [el(root), null]), false);
});

test("a press on the page focuses the reader", () => {
  assert.equal(pointerFocusTarget(el(canvas), el(root)), root);
});

test("a press on a focusable control inside the reader leaves it to that control", () => {
  assert.equal(pointerFocusTarget(el(annotationButton), el(root)), null);
});

test("a reader on a hidden screen never owns the keys, even with focus on the body", () => {
  // The workspace and Papers stay mounted while another screen is up; Delete
  // there must not remove an annotation selected in a reader nobody can see.
  assert.equal(ownsReaderFocus(body as never, body as never, [root as never], false), false);
  assert.equal(ownsReaderFocus(page as never, body as never, [root as never], false), false);
  assert.equal(ownsReaderFocus(body as never, body as never, [root as never], true), true);
});
