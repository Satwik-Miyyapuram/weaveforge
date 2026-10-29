/**
 * The explorer's name box: Enter submits, but not the Enter that confirms an
 * IME composition, which would save a half-typed name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { InlineTitle } from "../ui/explorer-glyphs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function box() {
  const calls = { submit: [] as string[], cancel: 0 };
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      createElement(InlineTitle, {
        className: "x",
        initial: "",
        placeholder: "Name",
        onSubmit: (title: string) => void calls.submit.push(title),
        onCancel: () => void calls.cancel++,
      }),
    );
  });
  return { input: () => r.root.findByType("input"), calls };
}

const key = (k: string, extra: object = {}) => ({ key: k, preventDefault() {}, stopPropagation() {}, ...extra });

test("Enter while an IME is composing keeps the box open", () => {
  const { input, calls } = box();
  act(() => input().props.onChange({ target: { value: "にほ" } }));
  act(() => input().props.onKeyDown(key("Enter", { nativeEvent: { isComposing: true } })));
  act(() => input().props.onKeyDown(key("Enter", { keyCode: 229, nativeEvent: {} })));
  assert.deepEqual(calls.submit, []);
  act(() => input().props.onChange({ target: { value: "日本" } }));
  act(() => input().props.onKeyDown(key("Enter", { nativeEvent: {} })));
  assert.deepEqual(calls.submit, ["日本"]);
});

test("Escape cancels, and a later blur does not submit", () => {
  const { input, calls } = box();
  act(() => input().props.onKeyDown(key("Escape", { nativeEvent: {} })));
  act(() => input().props.onBlur());
  assert.equal(calls.cancel, 1);
  assert.deepEqual(calls.submit, []);
});
