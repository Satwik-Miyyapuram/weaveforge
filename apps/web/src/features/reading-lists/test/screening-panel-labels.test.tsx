/**
 * Each screening row names its reason box and decision group after the paper
 * (P2-177). The box had only a "reason" placeholder, so a screen reader read
 * the same nameless field on every row.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import { ScreeningPanel } from "../ui/screening-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

before(async () => { await loadTestCore(); });
after(() => setContainerForTests(null));

test("the reason box and decision group carry the paper's title (P2-177)", async () => {
  setContainerForTests({
    readingLists: {
      listItemsForLists: async () => [{ id: "i1", paperId: "p1", inheritedFromListId: null }],
      screenItems: { summarize: async () => null },
    },
    auth: { auth: { getUser: async () => ({ id: "me" }) } },
  } as never);
  const node = { list: { id: "l1", name: "L", parentId: null, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z" }, children: [] } as never;
  const papers = [{ id: "p1", title: "Attention" }] as never;
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(createElement(ScreeningPanel, { node, papers }));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  const reason = r.root.findAll((n) => n.type === "input" && n.props.className === "screening-reason");
  assert.equal(reason.length, 1);
  assert.equal(reason[0]!.props["aria-label"], "Reason for Attention");
  const group = r.root.findAll((n) => n.type === "span" && n.props.role === "group" && n.props["aria-label"] !== "Screening stage");
  assert.equal(group.length, 1);
  assert.equal(group[0]!.props["aria-label"], "Decision for Attention");
  await act(async () => { r.unmount(); });
});