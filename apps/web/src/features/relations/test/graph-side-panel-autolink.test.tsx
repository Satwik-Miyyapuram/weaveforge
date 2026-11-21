/**
 * A failed "Auto-link citations" says why and rejects nothing (P2-226). The
 * click handler had try/finally with no catch, so the failure was an
 * unhandled rejection and the button just came back with no word.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { Paper } from "@weaveforge/core";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import { PaperPanel } from "../ui/graph-side-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// next/link schedules its prefetch through `self`, which Node does not define.
const g = globalThis as { self?: unknown };
const savedSelf = g.self;
before(async () => { g.self = globalThis; await loadTestCore(); });
after(() => { g.self = savedSelf; setContainerForTests(null); });

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map(textOf).join("");
}

test("a failed auto-link shows its error and rejects nothing (P2-226)", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (err: unknown) => { unhandled.push(err); };
  process.on("unhandledRejection", onUnhandled);
  let refreshed = 0;
  setContainerForTests({
    graph: { linkCitations: { forPaper: async () => { throw new Error("citations offline"); } } },
  } as never);
  const paper = { id: "p1", title: "A paper", authors: [], tags: [] } as unknown as Paper;
  let r!: ReactTestRenderer;
  try {
    await act(async () => {
      r = create(createElement(PaperPanel, {
        paper,
        relations: [],
        papers: [paper],
        onRefresh: () => { refreshed += 1; },
        onSelectPaper: () => undefined,
        onSelectConcept: () => undefined,
      }));
    });
    const button = r.root.findAll((n) => n.type === "button" && textOf(n) === "Auto-link citations")[0];
    assert.ok(button, "the auto-link button is there");
    await act(async () => {
      button.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.match(textOf(r.root), /citations offline/, "the failure is shown");
    assert.ok(r.root.findAll((n) => n.type === "button" && textOf(n) === "Auto-link citations").length === 1, "the button is back");
    assert.equal(refreshed, 0);
    assert.deepEqual(unhandled, []);
  } finally {
    act(() => r?.unmount());
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", onUnhandled);
  }
});