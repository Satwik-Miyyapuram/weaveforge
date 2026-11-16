import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ArtifactPlaceholder } from "../ui/artifact-placeholder";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(reason: "desktop" | "missing", onRetry: () => void): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(createElement(ArtifactPlaceholder, { label: "loss.png", reason, onRetry }));
  });
  return tree!;
}

test("a missing file names itself and offers Retry", async () => {
  let retried = 0;
  const tree = await render("missing", () => {
    retried += 1;
  });
  const json = JSON.stringify(tree.toJSON());
  assert.match(json, /loss\.png/);
  assert.match(json, /Could not load this file/);
  const retry = tree.root.findAll((n) => n.type === "button");
  assert.equal(retry.length, 1);
  await act(async () => retry[0]!.props.onClick());
  assert.equal(retried, 1);
  await act(async () => tree.unmount());
});

test("a desktop-only file says so and has no Retry", async () => {
  const tree = await render("desktop", () => {});
  assert.match(JSON.stringify(tree.toJSON()), /On desktop only/);
  assert.equal(tree.root.findAll((n) => n.type === "button").length, 0);
  await act(async () => tree.unmount());
});
