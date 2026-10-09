/** The create bar: Highlight, Underline, Comment | Close; Comment turns into the input. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { SelectionCreateBar } from "../ui/selection-create-bar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("the bar offers icons in the mock's order, with a rule before Close", () => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(createElement(SelectionCreateBar, { at: { x: 0, top: 0, bottom: 0, below: false }, onCreate: () => {}, onCancel: () => {} }));
  });
  const kids = tree.root.find((n) => n.props.role === "toolbar").children.map((c) =>
    typeof c === "string" ? c : ((c.props.label as string | undefined) ?? c.props.className),
  );
  assert.deepEqual(kids, ["Highlight", "Underline", "Comment", "pdf-reader-create-vr", "Close"]);
  act(() => tree.unmount());
});

test("Comment opens the input and Save makes a highlight carrying it", () => {
  const made: unknown[] = [];
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      createElement(SelectionCreateBar, {
        at: { x: 0, top: 0, bottom: 0, below: false },
        color: "#ff6666",
        onCreate: (...args: unknown[]) => made.push(args),
        onCancel: () => {},
      }),
    );
  });
  act(() => tree.root.find((n) => n.type === "button" && n.props["aria-label"] === "Comment").props.onClick());
  const input = tree.root.find((n) => n.type === "input");
  assert.equal(input.props.placeholder, "Comment on this…");
  act(() => input.props.onChange({ target: { value: " a note " } }));
  act(() => input.props.onKeyDown({ key: "Enter", stopPropagation: () => {} }));
  assert.deepEqual(made, [["highlight", "#ff6666", "a note"]]);
  act(() => tree.unmount());
});
