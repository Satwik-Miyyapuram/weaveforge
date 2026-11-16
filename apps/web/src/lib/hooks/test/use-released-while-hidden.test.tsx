import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { ScreenActiveContext } from "../use-screen-active";
import { HIDDEN_RELEASE_MS, useReleasedWhileHidden } from "../use-released-while-hidden";

let released: boolean[] = [];

function Probe({ delayMs }: { delayMs?: number }) {
  released.push(useReleasedWhileHidden(delayMs));
  return null;
}

function screen(active: boolean, delayMs?: number) {
  return createElement(ScreenActiveContext.Provider, { value: active }, createElement(Probe, { delayMs }));
}

const last = () => released[released.length - 1];

beforeEach(() => {
  released = [];
  mock.timers.enable({ apis: ["setTimeout"] });
});
afterEach(() => mock.timers.reset());

test("a shown screen never releases, however long it stays", async () => {
  await act(async () => { create(screen(true)); });
  await act(async () => mock.timers.tick(HIDDEN_RELEASE_MS * 10));
  assert.equal(last(), false);
});

test("a hidden screen releases only after the delay", async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(screen(true, 1000)); });
  await act(async () => tree.update(screen(false, 1000)));
  assert.equal(last(), false);
  await act(async () => mock.timers.tick(999));
  assert.equal(last(), false);
  await act(async () => mock.timers.tick(1));
  assert.equal(last(), true);
});

test("showing the screen again takes it back at once, and the next hide waits again", async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(screen(false, 1000)); });
  await act(async () => mock.timers.tick(1000));
  assert.equal(last(), true);
  await act(async () => tree.update(screen(true, 1000)));
  assert.equal(last(), false);
  await act(async () => tree.update(screen(false, 1000)));
  assert.equal(last(), false);
  await act(async () => mock.timers.tick(500));
  assert.equal(last(), false);
  await act(async () => mock.timers.tick(500));
  assert.equal(last(), true);
});

test("a quick hop away and back does not release", async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(screen(true, 1000)); });
  await act(async () => tree.update(screen(false, 1000)));
  await act(async () => mock.timers.tick(600));
  await act(async () => tree.update(screen(true, 1000)));
  await act(async () => mock.timers.tick(5000));
  assert.equal(last(), false);
});

test("unmounting while hidden leaves no timer behind", async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(screen(false, 1000)); });
  const renders = released.length;
  await act(async () => tree.unmount());
  await act(async () => mock.timers.tick(5000));
  assert.equal(released.length, renders);
});

test("outside the workspace host (no provider) the screen counts as shown", async () => {
  await act(async () => { create(createElement(Probe, { delayMs: 10 })); });
  await act(async () => mock.timers.tick(100));
  assert.equal(last(), false);
});
