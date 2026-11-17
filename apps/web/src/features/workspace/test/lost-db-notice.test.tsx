/**
 * The lost-database notice: it shows when the database was recreated empty, names where the old
 * data was kept, says folder sync is paused until restart, and stays hidden for a healthy or
 * unreported database.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import "@/lib/test/react-harness";
import type { DesktopLocalDbState } from "@/lib/desktop/desktop-bridge";
import { lostDbNotice } from "../application/folder-lost-db-guard";
import { LostDbNotice } from "../ui/lost-db-notice";

const g = globalThis as { window?: unknown };
const original = g.window;
after(() => { g.window = original; });

const lost: DesktopLocalDbState = {
  failure: null,
  dataDir: "C:\\data\\local-pg\\data",
  recreatedEmpty: true,
  keptAside: "C:\\data\\local-pg.discarded-1763337600000",
};

function stubWindow(state: DesktopLocalDbState | Error) {
  g.window = {
    weaveforge: {
      fetchTitle: () => Promise.resolve({}),
      localDbState: () => (state instanceof Error ? Promise.reject(state) : Promise.resolve(state)),
    },
  };
}

const textOf = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");

async function mount(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(LostDbNotice));
    await new Promise((r) => setTimeout(r, 5));
  });
  return tree;
}

test("the notice names the kept-aside path and says folder sync waits for a restart", () => {
  const notice = lostDbNotice(lost);
  assert.ok(notice, "a recreated database has a notice");
  assert.match(notice.body, /kept aside at C:\\data\\local-pg\.discarded-1763337600000/);
  assert.match(notice.body, /Folder sync is paused until you restart the app/);
});

test("without a known path the notice still shows, without a stray null", () => {
  const notice = lostDbNotice({ ...lost, keptAside: null });
  assert.ok(notice);
  assert.doesNotMatch(notice.body, /null|undefined/);
});

test("a healthy or unreported database has no notice", () => {
  assert.equal(lostDbNotice({ failure: null, dataDir: "x" }), null);
  assert.equal(lostDbNotice({ failure: null, dataDir: "x", recreatedEmpty: false }), null);
  assert.equal(lostDbNotice(null), null);
});

test("the banner is visible over the page when the database was recreated empty", async () => {
  stubWindow(lost);
  const tree = await mount();
  const [banner] = tree.root.findAll((n) => n.props.className === "release-notice-banner");
  assert.ok(banner, "the banner renders");
  assert.equal(banner.props.role, "alert");
  assert.match(textOf(banner), /recreated empty/);
  assert.match(textOf(banner), /Folder sync is paused until you restart the app/);
  await act(async () => tree.unmount());
});

test("the banner is absent for a healthy database", async () => {
  stubWindow({ failure: null, dataDir: "x", recreatedEmpty: false });
  const tree = await mount();
  assert.equal(tree.root.findAll((n) => n.props.className === "release-notice-banner").length, 0);
  await act(async () => tree.unmount());
});

test("a failed state lookup shows no banner and does not throw", async () => {
  stubWindow(new Error("shell gone"));
  const tree = await mount();
  assert.equal(tree.root.findAll((n) => n.props.className === "release-notice-banner").length, 0);
  await act(async () => tree.unmount());
});
