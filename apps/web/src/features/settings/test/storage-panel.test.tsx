/**
 * Settings → Data lists the app's own folders with their sizes and clears one
 * only after a second, explicit click.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import "@/lib/test/react-harness";
import { StoragePanel, formatBytes } from "../ui/storage-panel";

const g = globalThis as { window?: unknown };
const original = g.window;
after(() => { g.window = original; });

type Area = { id: string; bytes: number; files: number };

function stubWindow(areas: Area[], clear: (id: string) => Promise<void> = async () => {}) {
  const calls = { usage: 0, cleared: [] as string[] };
  g.window = {
    weaveforge: {
      fetchTitle: () => Promise.resolve({}),
      storageUsage: async () => { calls.usage += 1; return areas; },
      clearStorage: async (id: string) => { calls.cleared.push(id); await clear(id); },
    },
  };
  return calls;
}

const textOf = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
const buttons = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.type === "button" && textOf(n).includes(label));

async function mount(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(StoragePanel));
    await new Promise((r) => setTimeout(r, 5));
  });
  return tree;
}

async function click(node: ReactTestInstance) {
  await act(async () => {
    node.props.onClick();
    await new Promise((r) => setTimeout(r, 5));
  });
}

test("formatBytes", () => {
  assert.equal(formatBytes(0), "Empty");
  assert.equal(formatBytes(512), "512 bytes");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(3.25 * 1024 ** 3), "3.3 GB");
});

test("shows nothing without the bridge", async () => {
  g.window = {};
  const tree = await mount();
  assert.equal(tree.toJSON(), null);
  await act(async () => tree.unmount());
});

test("lists each folder with its size", async () => {
  stubWindow([
    { id: "artifacts", bytes: 0, files: 0 },
    { id: "models", bytes: 5 * 1024 * 1024, files: 2 },
    { id: "log", bytes: 2048, files: 1 },
  ]);
  const tree = await mount();
  const text = textOf(tree.root);
  assert.match(text, /Space on this computer/);
  assert.match(text, /Saved artifacts.*Empty/);
  assert.match(text, /Downloaded models.*5\.0 MB/);
  assert.match(text, /Application log.*2\.0 KB/);
  // An empty folder has nothing to clear.
  assert.equal(buttons(tree, "Clear").length, 2);
  await act(async () => tree.unmount());
});

test("clearing asks first, then clears and refreshes", async () => {
  const calls = stubWindow([{ id: "models", bytes: 100, files: 1 }]);
  const tree = await mount();
  await click(buttons(tree, "Clear")[0]!);
  assert.deepEqual(calls.cleared, []);
  assert.equal(buttons(tree, "Cancel").length, 1);
  await click(buttons(tree, "Delete 1 file")[0]!);
  assert.deepEqual(calls.cleared, ["models"]);
  assert.equal(calls.usage, 2);
  await act(async () => tree.unmount());
});

test("cancel clears nothing", async () => {
  const calls = stubWindow([{ id: "log", bytes: 100, files: 1 }]);
  const tree = await mount();
  await click(buttons(tree, "Clear")[0]!);
  await click(buttons(tree, "Cancel")[0]!);
  assert.deepEqual(calls.cleared, []);
  assert.equal(buttons(tree, "Clear").length, 1);
  await act(async () => tree.unmount());
});

test("a failed clear shows the shell's message", async () => {
  stubWindow([{ id: "models", bytes: 100, files: 3 }], async () => {
    throw new Error("Some files could not be deleted.");
  });
  const tree = await mount();
  await click(buttons(tree, "Clear")[0]!);
  await click(buttons(tree, "Delete 3 files")[0]!);
  assert.match(textOf(tree.root), /Some files could not be deleted/);
  await act(async () => tree.unmount());
});
