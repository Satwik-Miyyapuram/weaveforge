import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { WorkshopPdfViewer } from "../ui/workshop-pdf-viewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const textOf = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");

async function render(element: ReturnType<typeof createElement>) {
  let tree: ReactTestRenderer | undefined;
  await act(async () => { tree = create(element); });
  return tree!;
}

test("the PDF bar is one row: Recompile shows its progress, and a failed compile keeps it in reach", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  let fail: (e: Error) => void = () => {};
  globalThis.fetch = (() => { calls++; return new Promise((_, reject) => { fail = reject; }); }) as typeof fetch;
  try {
    const tree = await render(createElement(WorkshopPdfViewer, { sessionId: "s", projectId: "p", authHeaders: async () => ({}) }));
    const recompile = () => tree.root.find((n) => n.type === "button" && /^(Recompile|Compiling…)$/.test(textOf(n)));
    assert.equal(textOf(recompile()), "Compiling…");
    assert.equal(recompile().props.disabled, true);
    await act(async () => { fail(new Error("offline")); await Promise.resolve(); });
    assert.equal(textOf(recompile()), "Recompile");
    assert.equal(recompile().props.disabled, false);
    assert.equal(tree.root.findAll((n) => n.props.className === "workshop-pdf__bar").length, 1, "one bar, not a second strip");
    await act(async () => recompile().props.onClick());
    assert.equal(calls, 2);
    await act(async () => tree.unmount());
  } finally {
    globalThis.fetch = realFetch;
  }
});
