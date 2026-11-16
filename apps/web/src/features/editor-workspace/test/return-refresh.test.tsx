/**
 * The workspace stays mounted behind other screens (`workspace-host.tsx`).
 * Coming back reads its lists again with no loader, and opens a document
 * another screen handed over with `?open=kind:id`; staying hidden or the
 * first show does neither.
 */
import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ScreenActiveContext } from "@/lib/hooks/use-screen-active";
import { loadTestCore } from "@/lib/test/load-test-core";
import type { Document, WorkspaceData } from "../application/parts";
import { useReturnRefresh } from "../ui/use-return-refresh";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
before(loadTestCore);

let search = "";
let replaced: string[] = [];
beforeEach(() => {
  search = "";
  replaced = [];
  Object.assign(globalThis, {
    window: {
      ...(globalThis as { window?: object }).window,
      location: { get search() { return search; }, pathname: "/workspace" },
      history: { replaceState: (_s: unknown, _t: string, url: string) => { replaced.push(url); search = ""; } },
    },
  });
});

const doc = { kind: "vault_page", id: "n1", title: "Note", body: "text" } as unknown as Document;

function harness() {
  let reloads = 0;
  const opened: Document[] = [];
  const errors: string[] = [];
  const reload = async () => {
    reloads++;
    return { documents: [doc] } as unknown as WorkspaceData;
  };
  const open = (d: Document) => void opened.push(d);
  const setError = (m: string) => void errors.push(m);
  function Probe() {
    useReturnRefresh(reload, open, setError);
    return null;
  }
  let tree: ReactTestRenderer | undefined;
  const show = async (shown: boolean) => {
    const el = createElement(ScreenActiveContext.Provider, { value: shown }, createElement(Probe));
    await act(async () => {
      if (tree) tree.update(el);
      else tree = create(el);
    });
  };
  return { show, reloads: () => reloads, opened, errors, unmount: () => act(async () => tree?.unmount()) };
}

test("the first show and staying hidden read nothing again", async () => {
  const h = harness();
  await h.show(true);
  await h.show(true);
  await h.show(false);
  await h.show(false);
  assert.equal(h.reloads(), 0);
  await h.unmount();
});

test("coming back reads the lists again, once per return", async () => {
  const h = harness();
  await h.show(true);
  await h.show(false);
  await h.show(true);
  assert.equal(h.reloads(), 1);
  await h.show(false);
  await h.show(true);
  assert.equal(h.reloads(), 2);
  assert.deepEqual(h.opened, []);
  assert.deepEqual(replaced, [], "no ?open, the URL is left alone");
  await h.unmount();
});

test("a ?open handed over while hidden opens on return and leaves the URL", async () => {
  const h = harness();
  await h.show(true);
  await h.show(false);
  search = "?open=vault_page:n1";
  await h.show(true);
  assert.deepEqual(h.opened, [doc]);
  assert.deepEqual(replaced, ["/workspace"]);
  await h.unmount();
});

test("a ?open naming a document that is gone opens nothing, still leaves the URL", async () => {
  const h = harness();
  await h.show(true);
  await h.show(false);
  search = "?open=vault_page:missing";
  await h.show(true);
  assert.deepEqual(h.opened, []);
  assert.deepEqual(replaced, ["/workspace"]);
  await h.unmount();
});
