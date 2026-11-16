import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { navFoldSnapshot, useFoldNav } from "../use-nav-fold";

function Claim({ on }: { on: boolean }) {
  useFoldNav(on);
  return null;
}

test("a screen that claims the window folds the app nav until it unmounts", async () => {
  assert.equal(navFoldSnapshot(), false);
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(createElement(Claim, { on: true })); });
  assert.equal(navFoldSnapshot(), true);
  await act(async () => tree.unmount());
  assert.equal(navFoldSnapshot(), false);
});

test("an inactive claim folds nothing, and two claims hold until both let go", async () => {
  let a!: ReturnType<typeof create>;
  let b!: ReturnType<typeof create>;
  await act(async () => { a = create(createElement(Claim, { on: false })); });
  assert.equal(navFoldSnapshot(), false);
  await act(async () => a.update(createElement(Claim, { on: true })));
  await act(async () => { b = create(createElement(Claim, { on: true })); });
  await act(async () => a.unmount());
  assert.equal(navFoldSnapshot(), true);
  await act(async () => b.unmount());
  assert.equal(navFoldSnapshot(), false);
});
