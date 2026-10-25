import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement, Fragment } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { PromptDialog } from "../prompt-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { document?: unknown }).document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  activeElement: null,
  documentElement: { clientWidth: 1200 },
  body: { style: {} },
};
Object.assign(globalThis, {
  window: { innerWidth: 1200, innerHeight: 800, addEventListener: () => {}, removeEventListener: () => {} },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
});
// react-test-renderer has no portals; render the dialog in place.
createRequire(import.meta.url)("react-dom").createPortal = (node: unknown) => node;

test("two prompts with the same title get distinct, linked input ids (13-14)", () => {
  const props = { title: "Rename page", body: "", label: "Name", onConfirm() {}, onClose() {} };
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(createElement(Fragment, null, createElement(PromptDialog, props), createElement(PromptDialog, props)));
  });
  const inputs = tree!.root.findAllByType("input");
  const labels = tree!.root.findAll((node) => node.type === "label" && node.props.className === "prompt-dialog-field");
  assert.equal(inputs.length, 2);
  assert.notEqual(inputs[0]!.props.id, inputs[1]!.props.id);
  assert.deepEqual(labels.map((label) => label.props.htmlFor), inputs.map((input) => input.props.id));
});
