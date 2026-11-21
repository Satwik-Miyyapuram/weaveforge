/**
 * A failed title lookup keeps the proposed title and rejects nothing (P2-193).
 * The lookup had `.finally` but no `.catch`, so a network failure was an
 * unhandled rejection.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { TitleFix } from "@weaveforge/wasm";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import { TitleFixRow } from "../ui/library-tidy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

before(async () => { await loadTestCore(); });
after(() => setContainerForTests(null));

test("a failed title lookup keeps the proposed title and rejects nothing (P2-193)", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (err: unknown) => { unhandled.push(err); };
  process.on("unhandledRejection", onUnhandled);
  setContainerForTests({
    libraryTidy: { lookUpTitle: async () => { throw new Error("lookup offline"); } },
  } as never);
  const fix = { id: "p1", current: "untitled", proposed: "Proposed title", lookup: "10.1/x" } as unknown as TitleFix;
  let r!: ReactTestRenderer;
  try {
    await act(async () => {
      r = create(createElement(TitleFixRow, { fix, onApplied: () => undefined }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    const input = r.root.findByType("input");
    assert.equal(input.props.value, "Proposed title");
    assert.equal(input.props.placeholder, "Type the paper's title", "it still says Looking up");
    assert.deepEqual(unhandled, []);
  } finally {
    act(() => r?.unmount());
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", onUnhandled);
  }
});