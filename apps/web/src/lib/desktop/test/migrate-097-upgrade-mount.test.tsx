/**
 * The web upgrade screen must wait for Start: mounting it runs no export, and one
 * Start press runs exactly one. Mounted for real (not server-rendered), so the
 * mount-time effect is exercised.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import React, { type ReactNode } from "react";
import ReactDOM from "react-dom";
import { act, create, type ReactTestInstance } from "react-test-renderer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The component file uses JSX without importing React; under node --test the transform is classic, so expose React first.
Object.assign(globalThis, { React });

// The node runner has no DOM and the test renderer cannot portal, so the modal
// portal is rendered in place. Same stubs as the modal tests.
(ReactDOM as unknown as { createPortal: (node: ReactNode) => ReactNode }).createPortal = (node) => node;

// Put back whatever document and window were before this file, so the stubs do not leak.
const GLOBAL_KEYS = ["document", "window"] as const;
const savedGlobals = GLOBAL_KEYS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
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
after(() => {
  for (const [key, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map(textOf).join("");
}

function buttonLabelled(root: ReactTestInstance, label: string): ReactTestInstance {
  const match = root.findAll((n) => n.type === "button" && textOf(n) === label);
  assert.equal(match.length, 1, `exactly one "${label}" button`);
  return match[0]!;
}

test("web upgrade runs no export on mount and exactly one export after Start", async () => {
  const { Migrate097Upgrade } = await import("../migrate-097-upgrade");
  let calls = 0;
  const runExport = async () => {
    calls += 1;
    return { state: "verified" as const };
  };

  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(
      React.createElement(Migrate097Upgrade, {
        folder: "C:\\ws",
        runExport,
        onReady: () => {},
        onKeepOld: () => {},
      }),
    );
  });
  assert.equal(calls, 0, "mounting the web screen must not run the export");

  const start = buttonLabelled(tree!.root, "Start");
  await act(async () => {
    (start.props as { onClick: () => void }).onClick();
  });
  assert.equal(calls, 1, "one Start calls the export once");

  await act(async () => {
    tree!.unmount();
  });
});
