/**
 * A grant that fails part-way leaves the dialog matching the server (P2-243).
 * The recipients were granted one by one in one action, so a failure on the
 * second kept every name selected and skipped the reload: the first person was
 * shared with but still showed as one to add, and Share would grant them again.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import ReactDOM from "react-dom";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import { ProfileProvider } from "@/features/org/ui/profile-provider";
import { AuthContext } from "@/features/auth/ui/auth-provider";
import { Button } from "@/components/button";
import { MemberPicker } from "../ui/member-picker";
import { ShareDialog } from "../ui/share-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The node runner has no DOM and the test renderer cannot portal.
(ReactDOM as unknown as { createPortal: (node: ReactNode) => ReactNode }).createPortal = (node) => node;
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

before(async () => { await loadTestCore(); });
after(() => setContainerForTests(null));

/** Every path resolves to an empty list unless `over` names it. */
function stub(over: Record<string, unknown> = {}): unknown {
  return new Proxy(() => undefined, {
    get: (_t, key) => {
      if (key === "then") return undefined;
      const hit = over[key as string];
      if (typeof hit === "function") return hit;
      return stub((hit ?? {}) as Record<string, unknown>);
    },
    apply: () => Promise.resolve([]),
  });
}

test("a grant that fails on the second person drops the first from the picks and reloads (P2-243)", async () => {
  const granted: string[] = [];
  let lists = 0;
  setContainerForTests(stub({
    sharing: {
      listDirectory: async () => ["a", "b", "c"].map((id) => ({ id, fullName: `Person ${id}` })),
      shareLinksEnabled: () => false,
      manageSharing: {
        listForResource: async () => {
          lists += 1;
          return granted.map((recipientId) => ({ id: `s-${recipientId}`, recipientId, access: "comment" }));
        },
        grant: async ({ recipientId }: { recipientId: string }) => {
          if (recipientId === "b") throw new Error("grant refused");
          granted.push(recipientId);
        },
      },
    },
  }) as never);
  const auth = { user: null, loading: false, expired: false, sessionEpoch: 0, signOut: async () => {}, updatePassword: async () => {} } as never;
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(createElement(AuthContext.Provider, { value: auth },
      createElement(ProfileProvider, null,
        createElement(ShareDialog, { resourceType: "vault_page", resourceId: "n1", projectId: "p1", title: "Share", onClose: () => {} }))));
  });
  const picker = () => r.root.findByType(MemberPicker);
  for (const id of ["a", "b", "c"]) await act(async () => { picker().props.onToggle(id); });
  assert.deepEqual(picker().props.selected, ["a", "b", "c"]);
  const listsBefore = lists;
  const share = r.root.findAllByType(Button).find((b) => b.props.variant === "primary")!;
  await act(async () => {
    share.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  assert.deepEqual(granted, ["a"]);
  assert.ok(lists > listsBefore, "the list was reloaded after the failure");
  assert.deepEqual(picker().props.selected, ["b", "c"], "the person already shared with is no longer picked");
  assert.match(JSON.stringify(r.toJSON()), /grant refused/);
  await act(async () => { r.unmount(); });
});