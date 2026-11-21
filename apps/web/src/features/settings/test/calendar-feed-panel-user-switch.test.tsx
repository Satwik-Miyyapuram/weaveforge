/**
 * Switching account reloads the calendar link. The previous account's link
 * could answer last and be shown to the new account (P2-237).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { setContainerForTests } from "@/bootstrap";
import { AuthContext } from "@/features/auth";
import { CalendarFeedPanel } from "../ui/calendar-feed-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function auth(id: string) {
  return { user: { id }, loading: false, expired: false, sessionEpoch: 0, signOut: async () => {}, updatePassword: async () => {} } as never;
}

test("the previous account's calendar link answering last is not shown (P2-237)", async (t) => {
  const answers: ((link: unknown) => void)[] = [];
  setContainerForTests({
    plan: { feedLinks: { current: () => new Promise((resolve) => answers.push(resolve)) } },
  } as never);
  t.after(() => setContainerForTests(null));

  const panel = (id: string) => createElement(AuthContext.Provider, { value: auth(id) }, createElement(CalendarFeedPanel));
  let root!: ReactTestRenderer;
  await act(async () => { root = create(panel("alice")); });
  await act(async () => { root.update(panel("bob")); });
  assert.equal(answers.length, 2, "switching account reloads the link");

  await act(async () => { answers[1]!(null); });
  await act(async () => { answers[0]!({ tokenPrefix: "wfc_alice", createdAt: null, lastUsedAt: null }); });

  const text = JSON.stringify(root.toJSON());
  assert.match(text, /No link yet/);
  assert.doesNotMatch(text, /wfc_alice/, "alice's link must not show for bob");
  root.unmount();
});
