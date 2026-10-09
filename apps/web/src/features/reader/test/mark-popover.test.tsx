/** A tapped mark's popover: kind, colour, Delete, then its comment inline. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { markActions } from "../application/mark-actions";
import { MarkPopover } from "../ui/mark-popover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function text(node: ReactTestInstance): string {
  return node.children.map((c) => (typeof c === "string" ? c : text(c))).join("");
}

function mount(comment: string, type: "highlight" | "text" = "highlight", onComment: (c: string) => void = () => {}) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      createElement(MarkPopover, {
        at: { x: 100, top: 50, bottom: 70, below: false },
        actions: markActions({ type, origin: "local", comment })!,
        colour: "#ffd400",
        colours: ["#ffd400", "#ff6666"],
        onColour: () => {},
        onComment,
        onDelete: () => {},
        onClose: () => {},
      }),
    );
  });
  return tree;
}

function labels(tree: ReactTestRenderer) {
  return tree.root
    .findAll((n) => n.type === "button")
    .map((n) => (n.props["aria-label"] as string | undefined) ?? text(n));
}

test("a commented mark: kind, round swatches, Delete, then its comment and Edit comment", () => {
  const tree = mount("key claim");
  assert.equal(text(tree.root.find((n) => n.props.className === "pdf-reader-pop-kind")), "Highlight");
  assert.deepEqual(labels(tree), ["Colour #ffd400", "Colour #ff6666", "Delete", "Edit comment"]);
  assert.equal(text(tree.root.find((n) => n.props.className === "pdf-reader-pop-quote")), "“key claim”");
  assert.equal(tree.root.find((n) => n.props["aria-label"] === "Colour #ffd400").props["aria-pressed"], true);
  act(() => tree.unmount());
});

test("a bare mark offers Comment, which opens the input in place and saves trimmed", () => {
  const saved: string[] = [];
  const tree = mount("", "highlight", (c) => saved.push(c));
  assert.deepEqual(labels(tree).slice(-1), ["Comment"]);
  act(() => tree.root.find((n) => n.type === "button" && text(n) === "Comment").props.onClick());
  const input = tree.root.find((n) => n.type === "input");
  assert.equal(input.props.placeholder, "Add a comment…");
  act(() => input.props.onChange({ target: { value: "  why  " } }));
  act(() => tree.root.find((n) => n.type === "button" && text(n) === "Save").props.onClick());
  assert.deepEqual(saved, ["why"]);
  act(() => tree.unmount());
});

test("a text box offers Delete only", () => {
  const tree = mount("", "text");
  assert.deepEqual(labels(tree), ["Delete"]);
  act(() => tree.unmount());
});
