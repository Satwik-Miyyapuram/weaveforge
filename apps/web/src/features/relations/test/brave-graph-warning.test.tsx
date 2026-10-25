/**
 * The Brave probe (26-17): a probe that fails leaves no unhandled rejection
 * and shows no warning; one that says yes shows it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { BraveGraphWarning } from "../ui/brave-graph-warning";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function withBrave(isBrave: () => Promise<boolean>) {
  Object.defineProperty(globalThis, "navigator", { value: { brave: { isBrave } }, configurable: true });
}

async function render(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(BraveGraphWarning));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return tree;
}

test("a failing Brave probe is swallowed and warns nothing", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  withBrave(() => Promise.reject(new Error("probe failed")));
  const tree = await render();
  await new Promise((r) => setTimeout(r, 10));
  process.off("unhandledRejection", onUnhandled);
  assert.deepEqual(unhandled, []);
  assert.equal(tree.toJSON(), null);
  act(() => tree.unmount());
});

test("Brave is warned about", async () => {
  withBrave(async () => true);
  const tree = await render();
  assert.ok(tree.root.findAll((n) => n.props.role === "alert").length > 0);
  act(() => tree.unmount());
});
