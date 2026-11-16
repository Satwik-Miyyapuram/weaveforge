/**
 * The boot snapshot overlay (`boot-snapshot.tsx`): the last screen, painted
 * read-only while the core and the database start, gone as soon as the live
 * screen is up or anything says it might be wrong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { markScreenShown } from "@/lib/screen-shown";
import { BootSnapshotView } from "../boot-snapshot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const snap = { html: "<div class=\"layout\">last screen</div>", userId: "u1" };

type Props = { userId?: string | null; pathname?: string; load?: () => Promise<typeof snap | null>; onForget?: () => void };

const loadSnap = async () => snap;

function view({ userId, pathname = "/papers", load = loadSnap, onForget = () => {} }: Props) {
  return createElement(BootSnapshotView, { userId, pathname, load, onForget });
}

async function mount(props: Props): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(view(props));
  });
  return tree!;
}

const overlay = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => n.type === "div" && n.props.className === "boot-snapshot")[0];

test("a saved screen paints, inert and hidden from assistive tech, while auth resolves", async () => {
  const tree = await mount({ userId: undefined });
  const el = overlay(tree);
  assert.ok(el, "shown");
  assert.equal(el.props.inert, true);
  assert.equal(el.props["aria-hidden"], true);
  assert.equal(el.props.dangerouslySetInnerHTML.__html, snap.html);
  await act(async () => tree.unmount());
});

test("no saved screen: nothing renders", async () => {
  const tree = await mount({ userId: undefined, load: async () => null });
  assert.equal(overlay(tree), undefined);
  assert.equal(tree.toJSON(), null);
  await act(async () => tree.unmount());
});

test("the same user signed in: stays until the live screen is shown, then goes", async () => {
  const tree = await mount({ userId: undefined });
  await act(async () => tree.update(view({ userId: "u1" })));
  assert.ok(overlay(tree), "still shown: the live screen is not up yet");
  await act(async () => markScreenShown("papers"));
  assert.equal(overlay(tree), undefined);
  await act(async () => tree.unmount());
});

test("signed out: goes, and the snapshot is forgotten", async () => {
  let forgot = 0;
  const tree = await mount({ userId: undefined, onForget: () => (forgot += 1) });
  await act(async () => tree.update(view({ userId: null, onForget: () => (forgot += 1) })));
  assert.equal(overlay(tree), undefined);
  assert.equal(forgot, 1);
  await act(async () => tree.unmount());
});

test("another user signed in: goes, and the snapshot is forgotten", async () => {
  let forgot = 0;
  const tree = await mount({ userId: undefined, onForget: () => (forgot += 1) });
  await act(async () => tree.update(view({ userId: "u2", onForget: () => (forgot += 1) })));
  assert.equal(overlay(tree), undefined);
  assert.equal(forgot, 1);
  await act(async () => tree.unmount());
});

test("auth already resolved to another user before the snapshot loaded: never shown", async () => {
  const tree = await mount({ userId: "u2" });
  assert.equal(overlay(tree), undefined);
  await act(async () => tree.unmount());
});

test("a navigation away from the saved screen removes it", async () => {
  const tree = await mount({ userId: "u1" });
  assert.ok(overlay(tree));
  await act(async () => tree.update(view({ userId: "u1", pathname: "/notes" })));
  assert.equal(overlay(tree), undefined);
  await act(async () => tree.unmount());
});

test("a click or key press removes it, so input never lands on a picture", async () => {
  const target = new EventTarget();
  const g = globalThis as { window?: unknown };
  const had = "window" in g;
  const real = g.window;
  g.window = target;
  try {
    const tree = await mount({ userId: "u1" });
    assert.ok(overlay(tree));
    await act(async () => void target.dispatchEvent(new Event("pointerdown")));
    assert.equal(overlay(tree), undefined);
    await act(async () => tree.unmount());
  } finally {
    if (had) g.window = real;
    else delete g.window;
  }
});

test("a broken load is a miss, not an error", async () => {
  const tree = await mount({ userId: undefined, load: () => Promise.reject(new Error("boom")) });
  assert.equal(overlay(tree), undefined);
  await act(async () => tree.unmount());
});
