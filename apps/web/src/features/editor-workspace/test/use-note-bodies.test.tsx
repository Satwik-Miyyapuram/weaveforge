/**
 * A lazy note tab whose note is gone, or whose fetch failed, says so instead of
 * showing "Loading note…" forever (P2-141).
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { TabRef } from "@weaveforge/wasm";

import { renderHook } from "@/lib/test/react-harness";
import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import { HydratingDocument, useNoteBodies } from "../ui/use-note-bodies";

before(async () => { await loadTestCore(); });
after(() => setContainerForTests(null));

const TAB = { kind: "note", id: "n1" } as unknown as TabRef;

function withPage(getPage: (id: string) => Promise<unknown>) {
  setContainerForTests({ vault: { getPage } } as never);
}

async function harness() {
  const errors: string[] = [];
  const h = await renderHook(() => useNoteBodies(() => {}, (m) => void errors.push(m)), undefined);
  return { h, errors };
}

test("a note that no longer exists is reported, not left loading", async () => {
  withPage(() => Promise.resolve(null));
  const { h } = await harness();
  await act(async () => h.current.hydrate(TAB));
  await h.flush();
  assert.match(h.current.unavailable.get("n1")?.message ?? "", /no longer exists/);
  assert.equal(h.current.unavailable.get("n1")?.retryable, false);
});

test("a failed fetch is reported on the tab and Retry asks again", async () => {
  let calls = 0;
  withPage(() => (++calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve({ body: "full" })));
  const { h, errors } = await harness();
  await act(async () => h.current.hydrate(TAB));
  await h.flush();
  assert.match(h.current.unavailable.get("n1")?.message ?? "", /offline/);
  assert.equal(errors.length, 1);
  await act(async () => h.current.retry(TAB));
  await h.flush();
  assert.equal(calls, 2);
  assert.equal(h.current.unavailable.has("n1"), false);
  assert.equal(h.current.bodies.get("n1"), "full");
});

test("the tab shows the problem and a Retry button instead of the loader", async () => {
  let retried = 0;
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(
      createElement(HydratingDocument, {
        tab: TAB,
        hydrate: () => {},
        problem: "Could not load this note: offline",
        onRetry: () => void (retried += 1),
      }),
    );
  });
  const text = JSON.stringify(root.toJSON());
  assert.match(text, /Could not load this note: offline/);
  assert.doesNotMatch(text, /Loading note/);
  const button = root.root.find((n) => n.type === "button");
  await act(async () => button.props.onClick());
  assert.equal(retried, 1);
  root.unmount();
});