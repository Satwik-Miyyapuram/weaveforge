/**
 * Every share request opens a fresh dialog (P2-242). The host reused one
 * dialog for every request, so a second share kept the first one's staged
 * recipients, and Share would grant the new item to them.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import ReactDOM from "react-dom";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import type * as HostModule from "../ui/share-dialog-host";

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
  window: { innerWidth: 0, setTimeout, clearTimeout },
  self: globalThis,
});

// next/dynamic decides when first loaded whether it runs on a server, so the
// UI is imported only once `window` exists.
let Host!: typeof HostModule;
let MemberPicker!: typeof import("../ui/member-picker").MemberPicker;
let ProfileProvider!: typeof import("@/features/org").ProfileProvider;
let AuthContext!: typeof import("@/features/auth").AuthContext;
before(async () => {
  await loadTestCore();
  Host = await import("../ui/share-dialog-host");
  ({ MemberPicker } = await import("../ui/member-picker"));
  ({ ProfileProvider } = await import("@/features/org"));
  ({ AuthContext } = await import("@/features/auth"));
});
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("a second share request does not inherit the first one's picks (P2-242)", async () => {
  setContainerForTests(stub({
    sharing: {
      listDirectory: async () => ["a", "b"].map((id) => ({ id, fullName: `Person ${id}` })),
      shareLinksEnabled: () => false,
      manageSharing: { listForResource: async () => [] },
    },
  }) as never);
  let host: ReturnType<typeof HostModule.useShareDialogHost> = null;
  function Grab() {
    host = Host.useShareDialogHost();
    return null;
  }
  const auth = { user: null, loading: false, expired: false, sessionEpoch: 0, signOut: async () => {}, updatePassword: async () => {} } as never;
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(createElement(AuthContext.Provider, { value: auth },
      createElement(ProfileProvider, null,
        createElement(Host.ShareDialogHost, null, createElement(Grab)))));
  });
  const picker = () => r.root.findByType(MemberPicker);
  for (let i = 0; i < 20 && r.root.findAllByType(MemberPicker).length === 0; i++) {
    await act(async () => {
      if (i === 0) host!.open({ resourceType: "vault_page", resourceId: "n1", title: "Share A" });
      await settle();
    });
  }
  await act(async () => { picker().props.onToggle("a"); });
  assert.deepEqual(picker().props.selected, ["a"]);
  await act(async () => {
    host!.open({ resourceType: "vault_page", resourceId: "n2", title: "Share B" });
    await settle();
  });
  assert.equal(picker().props.selected.length, 0, "the new dialog starts with nobody picked");
  await act(async () => { r.unmount(); });
});