/**
 * A failed update check says so instead of reading "up to date", and the
 * automatic check on opening Settings can be turned off.
 *
 * The hook caches a good answer per module, so the tests run in order:
 * failures and the off switch first, a good answer last.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import "@/lib/test/react-harness";
import { DesktopUpdatePanel } from "../ui/desktop-update-panel";

const g = globalThis as { window?: unknown };
const original = g.window;
after(() => { g.window = original; });

function stubWindow(checkUpdate: () => Promise<unknown>, stored: Record<string, string> = {}) {
  const calls = { n: 0 };
  const store = { ...stored };
  g.window = {
    localStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
    },
    weaveforge: {
      fetchTitle: () => Promise.resolve({}),
      version: "0.5.2",
      platform: "win32",
      checkUpdate: () => { calls.n += 1; return checkUpdate(); },
    },
  };
  return { calls, store };
}

const textOf = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
const button = (tree: ReactTestRenderer, label: string) =>
  tree.root.find((n) => n.type === "button" && textOf(n).includes(label));
const toggle = (tree: ReactTestRenderer) => tree.root.find((n) => n.props.name === "autoUpdateCheck");

async function mount(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(DesktopUpdatePanel));
    await new Promise((r) => setTimeout(r, 5));
  });
  return tree;
}

test("a failed check shows an error, not 'No newer version'", async () => {
  const { calls } = stubWindow(() => Promise.reject(new Error("Could not check for an update.")));
  const tree = await mount();
  const text = textOf(tree.root);
  assert.match(text, /Could not check for updates\. Try again\./);
  assert.ok(!text.includes("No newer version"));
  assert.equal(calls.n, 1);
  await act(async () => tree.unmount());
});

test("a failure is not cached: the next mount checks again", async () => {
  const { calls } = stubWindow(() => Promise.reject(new Error("offline")));
  const tree = await mount();
  assert.equal(calls.n, 1);
  await act(async () => tree.unmount());
});

test("with the automatic check off, opening Settings asks nothing; Check now still asks", async () => {
  const { calls } = stubWindow(() => Promise.reject(new Error("offline")), { "weaveforge.desktop.autoUpdateCheck": "off" });
  const tree = await mount();
  assert.equal(calls.n, 0);
  assert.equal(toggle(tree).props.checked, false);
  assert.ok(!textOf(tree.root).includes("Checking"), "nothing pretends to be checking");
  await act(async () => {
    button(tree, "Check now").props.onClick();
    await new Promise((r) => setTimeout(r, 5));
  });
  assert.equal(calls.n, 1);
  assert.match(textOf(tree.root), /Could not check for updates/);
  await act(async () => tree.unmount());
});

test("the toggle stores the choice", async () => {
  const { store } = stubWindow(() => Promise.reject(new Error("offline")));
  const tree = await mount();
  assert.equal(toggle(tree).props.checked, true);
  await act(async () => toggle(tree).props.onChange({ target: { checked: false } }));
  assert.equal(store["weaveforge.desktop.autoUpdateCheck"], "off");
  assert.equal(toggle(tree).props.checked, false);
  await act(async () => toggle(tree).props.onChange({ target: { checked: true } }));
  assert.equal(store["weaveforge.desktop.autoUpdateCheck"], undefined);
  await act(async () => tree.unmount());
});

test("an available update is shown, and a good answer is cached", async () => {
  const { calls } = stubWindow(() => Promise.resolve({ version: "0.6.0", url: "https://example.invalid/v0.6.0" }));
  const first = await mount();
  assert.match(textOf(first.root), /Version 0\.6\.0 is available/);
  await act(async () => first.unmount());
  const second = await mount();
  assert.match(textOf(second.root), /Version 0\.6\.0 is available/);
  assert.equal(calls.n, 1);
  await act(async () => second.unmount());
});
