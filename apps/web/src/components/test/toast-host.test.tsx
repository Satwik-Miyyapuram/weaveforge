/** The toast region and its keyboard Undo (design D10). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ToastStore } from "@/lib/toast/toast-store";
import { ToastList, isUndoKey } from "../toast-host";

test("toasts render in a polite live region with their message, button and close", () => {
  const store = new ToastStore();
  store.deferDelete({ keys: ["a"], message: "Paper deleted", commit: () => {} });
  const html = renderToStaticMarkup(<ToastList store={store} toasts={store.snapshot()} />);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Paper deleted/);
  assert.match(html, />Undo</);
  assert.match(html, /aria-label="Dismiss"/);
  store.flush();
});

test("the live region is in the page even with no toast, so the first one is announced", () => {
  const html = renderToStaticMarkup(<ToastList store={new ToastStore()} toasts={[]} />);
  assert.match(html, /aria-live="polite"/);
});

test("Ctrl+Z or Cmd+Z undoes only outside a text field", () => {
  const div = { tagName: "DIV" } as unknown as EventTarget;
  const input = { tagName: "INPUT" } as unknown as EventTarget;
  const editable = { tagName: "DIV", isContentEditable: true } as unknown as EventTarget;
  const key = (over: Partial<KeyboardEvent>) => ({ key: "z", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: div, ...over }) as KeyboardEvent;
  assert.equal(isUndoKey(key({ ctrlKey: true })), true);
  assert.equal(isUndoKey(key({ metaKey: true, key: "Z" })), true);
  assert.equal(isUndoKey(key({ ctrlKey: true, shiftKey: true })), false, "Ctrl+Shift+Z is redo");
  assert.equal(isUndoKey(key({})), false);
  assert.equal(isUndoKey(key({ ctrlKey: true, target: input })), false);
  assert.equal(isUndoKey(key({ ctrlKey: true, target: editable })), false);
});
