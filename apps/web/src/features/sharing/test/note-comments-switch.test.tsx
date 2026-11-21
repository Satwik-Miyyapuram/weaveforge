/**
 * Moving from one note to another clears the comment composer (P2-245). The
 * draft, the quoted anchor and the reply box stayed put across a change of
 * resource, so a comment typed on note A could be posted on note B.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import { ProfileProvider } from "@/features/org";
import { AuthContext } from "@/features/auth";
import { NoteComments } from "../ui/note-comments";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

test("a draft typed on one note is gone when another note is shown (P2-245)", async () => {
  const added: unknown[] = [];
  setContainerForTests(stub({
    sharing: { manageComments: { list: async () => [], add: async (...args: unknown[]) => { added.push(args); } } },
  }) as never);
  const auth = { user: null, loading: false, expired: false, sessionEpoch: 0, signOut: async () => {}, updatePassword: async () => {} } as never;
  const view = (resourceId: string) =>
    createElement(AuthContext.Provider, { value: auth },
      createElement(ProfileProvider, null,
        createElement(NoteComments, { resourceType: "vault_page", resourceId, canComment: true, embedded: true })));
  let r!: ReactTestRenderer;
  await act(async () => { r = create(view("note-a")); });
  await act(async () => {
    r.root.findByType("textarea").props.onChange({ target: { value: "About note A" } });
  });
  assert.equal(r.root.findByType("textarea").props.value, "About note A");
  await act(async () => { r.update(view("note-b")); });
  assert.equal(r.root.findByType("textarea").props.value, "");
  assert.deepEqual(added, []);
  await act(async () => { r.unmount(); });
});