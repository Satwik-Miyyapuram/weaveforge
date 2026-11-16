/**
 * A modal opened inside a kept screen that is hidden (Papers behind another
 * screen) stays mounted but hidden, so it cannot float over the screen on show
 * and a half-filled form inside it is not lost.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReactNode } from "react";
import ReactDOM from "react-dom";
import { act, create } from "react-test-renderer";

import { ScreenActiveContext } from "@/lib/hooks/use-screen-active";
import { Modal } from "../modal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The node runner has no DOM and the test renderer cannot portal, so the
// portal is rendered in place; only what Modal returns is under test.
(ReactDOM as unknown as { createPortal: (node: ReactNode) => ReactNode }).createPortal = (node) => node;

// Modal touches `document` and `window` only once it mounts.
Object.assign(globalThis, {
  document: {
    body: { style: {} },
    documentElement: { clientWidth: 0 },
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
  },
  window: { innerWidth: 0 },
});

function inScreen(active: boolean) {
  return (
    <ScreenActiveContext.Provider value={active}>
      <Modal title="Paper" onClose={() => {}}>
        <p>body</p>
      </Modal>
    </ScreenActiveContext.Provider>
  );
}

test("a modal inside an inactive kept screen is hidden, children kept", async () => {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(inScreen(false));
  });
  const root = tree!.toJSON() as { props: { hidden?: boolean; style?: { display?: string } } };
  assert.equal(root.props.hidden, true);
  assert.equal(root.props.style?.display, "none");
  assert.ok(tree!.root.findByType("p"), "children stay mounted");
  // Nor does it lock scrolling on the screen that is shown.
  assert.notEqual((document.body.style as { overflow?: string }).overflow, "hidden");
  await act(async () => tree!.unmount());
});

test("a modal inside an active screen renders", async () => {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(inScreen(true));
  });
  assert.notEqual(tree!.toJSON(), null);
  await act(async () => tree!.unmount());
});
