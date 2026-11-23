/**
 * From 0.9.8 the server answers only `wff_` feed links, so the old `tt_` calendar link this panel
 * used to make is dead. The panel must not offer to make or turn off one, and must not ask the
 * container for one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { setContainerForTests } from "@/bootstrap";
import { AuthContext } from "@/features/auth";
import { CalendarFeedPanel } from "../ui/calendar-feed-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function auth() {
  return { user: { id: "alice" }, loading: false, expired: false, sessionEpoch: 0, signOut: async () => {}, updatePassword: async () => {} } as never;
}

async function render(): Promise<ReactTestRenderer> {
  // A plan facade with no feed links: any read of one throws.
  const plan = new Proxy({}, { get: (_t, key) => { throw new Error(`plan.${String(key)} must not be read`); } });
  setContainerForTests({ plan } as never);
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(createElement(AuthContext.Provider, { value: auth() }, createElement(CalendarFeedPanel)));
  });
  return root;
}

test("the calendar panel offers no tt_ link and says old links stopped working (0.9.8)", async (t) => {
  t.after(() => setContainerForTests(null));
  const root = await render();
  const text = JSON.stringify(root.toJSON());
  assert.doesNotMatch(text, /Make a link|Make a new link|Turn off/);
  assert.match(text, /no longer work/);
  root.unmount();
});
