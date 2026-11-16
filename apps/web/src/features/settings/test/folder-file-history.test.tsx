import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import type { FileHistorySource } from "@/features/workspace/application/parts-1";
import { FolderFileHistory } from "../ui/folder-file-history";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const textOf = (children: unknown): string =>
  typeof children === "string" ? children : Array.isArray(children) ? children.map(textOf).join("") : "";

const commit = (oid: string, message: string) => ({
  oid,
  message,
  authoredAt: "2026-11-05T09:00:00Z",
  author: "WeaveForge",
});

function source(texts: Record<string, string | null>): FileHistorySource & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    log: async (path) => {
      asked.push(path);
      return path === "notes/a.md" ? [commit("bbb", "Second"), commit("aaa", "First")] : [];
    },
    readAt: async (oid) => texts[oid] ?? null,
  };
}

const buttons = (tree: ReactTestRenderer, label: string): ReactTestInstance[] =>
  tree.root.findAll((n) => n.type === "button" && textOf(n.props.children) === label);
const json = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());

async function render(props: Parameters<typeof FolderFileHistory>[0]) {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(createElement(FolderFileHistory, props));
  });
  return tree!;
}

async function lookUp(tree: ReactTestRenderer, path: string) {
  const input = tree.root.findByType("input");
  await act(async () => input.props.onChange({ target: { value: path } }));
  await act(async () => buttons(tree, "Show versions")[0]!.props.onClick());
}

test("a file's versions list, and View shows the text as it was", async () => {
  const src = source({ aaa: "first text", bbb: null });
  const tree = await render({ source: src, restore: async () => {}, onRestored: () => {} });

  await lookUp(tree, "  notes/a.md ");
  assert.deepEqual(src.asked, ["notes/a.md"], "the path is trimmed");
  assert.match(json(tree), /Second/);
  assert.match(json(tree), /First/);

  await act(async () => buttons(tree, "View")[1]!.props.onClick());
  assert.match(json(tree), /first text/);
  await act(async () => buttons(tree, "View")[0]!.props.onClick());
  assert.match(json(tree), /not text/);
  await act(async () => tree.unmount());
});

test("a file with no versions says so", async () => {
  const tree = await render({ source: source({}), restore: async () => {}, onRestored: () => {} });
  await lookUp(tree, "other.md");
  assert.match(json(tree), /No saved versions of other\.md/);
  await act(async () => tree.unmount());
});

test("Restore asks first, then writes the version and hands over to the import preview", async () => {
  const restored: string[][] = [];
  let handedOver = 0;
  const tree = await render({
    source: source({ aaa: "first text" }),
    restore: async (oid, path) => {
      restored.push([oid, path]);
    },
    onRestored: () => {
      handedOver += 1;
    },
  });
  await lookUp(tree, "notes/a.md");

  await act(async () => buttons(tree, "Restore…")[1]!.props.onClick());
  assert.deepEqual(restored, [], "nothing is written before the confirm");
  await act(async () => buttons(tree, "Cancel")[0]!.props.onClick());
  assert.equal(buttons(tree, "Restore this version").length, 0);

  await act(async () => buttons(tree, "Restore…")[1]!.props.onClick());
  await act(async () => buttons(tree, "Restore this version")[0]!.props.onClick());
  assert.deepEqual(restored, [["aaa", "notes/a.md"]]);
  assert.equal(handedOver, 1);
  await act(async () => tree.unmount());
});

test("a failed restore shows why and does not hand over", async () => {
  let handedOver = 0;
  const tree = await render({
    source: source({ aaa: "first text" }),
    restore: async () => {
      throw new Error("disk full");
    },
    onRestored: () => {
      handedOver += 1;
    },
  });
  await lookUp(tree, "notes/a.md");
  await act(async () => buttons(tree, "Restore…")[0]!.props.onClick());
  await act(async () => buttons(tree, "Restore this version")[0]!.props.onClick());
  assert.match(json(tree), /disk full/);
  assert.equal(handedOver, 0);
  await act(async () => tree.unmount());
});
