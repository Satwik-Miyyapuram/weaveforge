/**
 * In files mode the calendar link is an api_tokens row the org server would hold, which the
 * files-mode guard refuses. The panel must not offer its make or turn-off buttons there.
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

function feedLinks() {
  return {
    current: async () => null,
    create: async () => { throw new Error("create must not be reached"); },
    revoke: async () => { throw new Error("revoke must not be reached"); },
  };
}

async function render(feedLinksAvailable: boolean): Promise<ReactTestRenderer> {
  setContainerForTests({ plan: { feedLinksAvailable, feedLinks: feedLinks() } } as never);
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(createElement(AuthContext.Provider, { value: auth() }, createElement(CalendarFeedPanel)));
  });
  return root;
}

test("files mode shows no make or turn-off button for the calendar link", async (t) => {
  t.after(() => setContainerForTests(null));
  const root = await render(false);
  assert.equal(root.root.findAll((n) => n.type === "button").length, 0, "no button is offered in files mode");
  assert.match(JSON.stringify(root.toJSON()), /not available in files mode/);
  root.unmount();
});

test("outside files mode the calendar link still offers its make button", async (t) => {
  t.after(() => setContainerForTests(null));
  const root = await render(true);
  assert.ok(root.root.findAll((n) => n.type === "button").length > 0, "a button is offered outside files mode");
  root.unmount();
});
