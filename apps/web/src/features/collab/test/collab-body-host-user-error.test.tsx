/**
 * The editor host does not hang on "Loading editor…" when the user id cannot
 * be read (P2-146). Both lookups had no `.catch`: a failed one was an
 * unhandled rejection and left the loading line up for good.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { setContainerForTests } from "@/bootstrap";
import { CollabBodyHost } from "../ui/collab-body-host";
import { CollabFacade } from "@/container/facades/collab";
import { LOCAL_USER_ID } from "@weaveforge/core";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("a failed user id shows a retry, and the retry asks again", async (t) => {
  // The paste settings watch the window; a stand-in with no events is enough.
  const g = globalThis as { window?: unknown };
  const previousWindow = g.window;
  g.window = { addEventListener() {}, removeEventListener() {} };
  t.after(() => {
    g.window = previousWindow;
  });
  let asked = 0;
  setContainerForTests({
    collab: {
      authorId: () => {
        asked += 1;
        return Promise.reject(new Error("offline"));
      },
      collabSession: () => ({}),
    },
    org: { loadProfile: () => Promise.reject(new Error("offline")) },
  } as never);
  t.after(() => setContainerForTests(null));

  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(
      createElement(CollabBodyHost, {
        resourceType: "note",
        resourceId: "n1",
        initialBody: "",
        onSave: (async () => {}) as never,
      }),
    );
  });
  const text = () => JSON.stringify(root.toJSON());
  assert.doesNotMatch(text(), /Loading editor/, "the host hung on loading");
  assert.match(text(), /Could not open the editor/);
  assert.equal(asked, 1);

  const retry = root.root.find((n) => n.type === "button" && /Try again/.test(JSON.stringify(n.children)));
  await act(async () => retry.props.onClick());
  assert.equal(asked, 2, "the retry did not ask again");
  await act(async () => root.unmount());
});

test("signed out, the author is the local user, not an error", async () => {
  const facade = new CollabFacade({
    session: { getCurrentUserId: async () => null, requireUserId: () => Promise.reject(new Error("Not signed in.")) },
  } as never);
  assert.equal(await facade.authorId(), LOCAL_USER_ID);
  const signedIn = new CollabFacade({
    session: { getCurrentUserId: async () => "u1", requireUserId: async () => "u1" },
  } as never);
  assert.equal(await signedIn.authorId(), "u1");
});

test("signed out, the host opens the editor instead of the retry", async (t) => {
  const g = globalThis as { window?: unknown };
  const previousWindow = g.window;
  g.window = { addEventListener() {}, removeEventListener() {} };
  t.after(() => {
    g.window = previousWindow;
  });
  setContainerForTests({
    collab: {
      authorId: async () => LOCAL_USER_ID,
      requireUserId: () => Promise.reject(new Error("Not signed in.")),
      collabSession: () => ({}),
    },
    org: { loadProfile: async () => null },
  } as never);
  t.after(() => setContainerForTests(null));
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(
      createElement(CollabBodyHost, {
        resourceType: "note",
        resourceId: "n1",
        initialBody: "",
        onSave: (async () => {}) as never,
      }),
    );
  });
  const text = JSON.stringify(root.toJSON());
  assert.doesNotMatch(text, /Could not open the editor/);
  assert.doesNotMatch(text, /Loading editor/);
  await act(async () => root.unmount());
});
