/**
 * The install gate: with an old database present and no verified 0.9.7 report it blocks the app
 * and renders none of the children; otherwise the children mount. The gate only reads the bridge.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import "@/lib/test/react-harness";
import { INSTALL_097_NOTICE, INSTALL_097_URL } from "../application/install-097-guard";
import { Install097Gate } from "../ui/install-097-gate";

const g = globalThis as { window?: unknown };
const original = g.window;
after(() => { g.window = original; });

function stubBridge(bridge: Record<string, unknown>) {
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}), ...bridge } };
}

const textOf = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");

const CHILD_MARK = "APP-BEHIND-GATE";
function Child() {
  return createElement("div", null, CHILD_MARK);
}

async function mount(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(Install097Gate, null, createElement(Child)));
    await new Promise((r) => setTimeout(r, 5));
  });
  return tree;
}

test("blocks: old DB present, no report -> notice and link only, children not mounted", async () => {
  stubBridge({ legacyDbPresent: () => Promise.resolve(true), migrationReportPresent: () => Promise.resolve(false) });
  const tree = await mount();
  const text = textOf(tree.root);
  assert.ok(text.includes(INSTALL_097_NOTICE.title));
  assert.ok(text.includes(INSTALL_097_NOTICE.body));
  assert.equal(tree.root.findAll((n) => n.type === Child).length, 0, "app must not mount behind the gate");
  assert.ok(!text.includes(CHILD_MARK));
  const link = tree.root.findAll((n) => n.type === "a" && n.props.href === INSTALL_097_URL);
  assert.equal(link.length, 1);
  assert.equal(link[0].props.target, "_blank");
  assert.equal(link[0].props.rel, "noopener noreferrer");
  tree.unmount();
});

test("blocks: report method absent (unknown) while old DB present -> still blocked", async () => {
  stubBridge({ legacyDbPresent: () => Promise.resolve(true) });
  const tree = await mount();
  assert.equal(tree.root.findAll((n) => n.type === Child).length, 0);
  tree.unmount();
});

test("passes: old DB absent -> children mount, no notice", async () => {
  stubBridge({ legacyDbPresent: () => Promise.resolve(false) });
  const tree = await mount();
  assert.equal(tree.root.findAll((n) => n.type === Child).length, 1, "app mounts");
  assert.ok(!textOf(tree.root).includes(INSTALL_097_NOTICE.title));
  tree.unmount();
});

test("passes: old DB present and verified report -> children mount", async () => {
  stubBridge({ legacyDbPresent: () => Promise.resolve(true), migrationReportPresent: () => Promise.resolve(true) });
  const tree = await mount();
  assert.equal(tree.root.findAll((n) => n.type === Child).length, 1);
  tree.unmount();
});

test("passes: browser (no desktop bridge) -> children mount at once", async () => {
  g.window = undefined;
  const tree = await mount();
  assert.equal(tree.root.findAll((n) => n.type === Child).length, 1);
  tree.unmount();
});

test("blocks: legacy check rejects (unknown) -> blocked, children not mounted", async () => {
  stubBridge({ legacyDbPresent: () => Promise.reject(new Error("ipc down")) });
  const tree = await mount();
  assert.equal(tree.root.findAll((n) => n.type === Child).length, 0);
  assert.ok(textOf(tree.root).includes(INSTALL_097_NOTICE.title));
  tree.unmount();
});

test("blocks: desktop shell without legacyDbPresent -> blocked", async () => {
  stubBridge({});
  const tree = await mount();
  assert.equal(tree.root.findAll((n) => n.type === Child).length, 0);
  tree.unmount();
});

test("blocks: check never answers -> blocked after the timeout", async () => {
  stubBridge({ legacyDbPresent: () => new Promise(() => {}) });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(Install097Gate, { checkTimeoutMs: 10 }, createElement(Child)));
  });
  // The timeout starts when the effect flushes at the end of act, so wait in a second act.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  assert.equal(tree.root.findAll((n) => n.type === Child).length, 0);
  assert.ok(textOf(tree.root).includes(INSTALL_097_NOTICE.title));
  tree.unmount();
});

test("retry re-runs the check and mounts the app once it passes", async () => {
  let answer = true;
  stubBridge({ legacyDbPresent: () => Promise.resolve(answer) });
  const tree = await mount();
  assert.equal(tree.root.findAll((n) => n.type === Child).length, 0);
  answer = false;
  const button = tree.root.findAll((n) => n.type === "button")[0];
  await act(async () => {
    button.props.onClick();
    await new Promise((r) => setTimeout(r, 5));
  });
  assert.equal(tree.root.findAll((n) => n.type === Child).length, 1);
  tree.unmount();
});
