import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import { shortcutTable, type WorkspaceCommand } from "../application/keybindings";
import { CHEATSHEET_COMMANDS } from "../ui/shortcuts-dialog";
import { ShortcutGrid } from "../ui/pane-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const textOf = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");

test("the cheatsheet lists every command but the per-number tab jumps", () => {
  const all = Object.keys(shortcutTable()) as WorkspaceCommand[];
  const hidden = all.filter((command) => !CHEATSHEET_COMMANDS.includes(command));
  assert.deepEqual(hidden.sort(), ["tab-2", "tab-3", "tab-4", "tab-5", "tab-6", "tab-7", "tab-8"]);
});

test("the grid prints each command's label beside its keycaps", async () => {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(createElement(ShortcutGrid, { commands: ["reopen-tab", "show-shortcuts"] }));
  });
  const rows = tree!.root.findAll((n) => n.props.className === "pane-shortcut");
  assert.equal(rows.length, 2);
  assert.match(textOf(rows[0]!), /Reopen closed tab/);
  assert.equal(rows[0]!.findAllByType("kbd").length, 3, "⌘ ⇧ T");
  assert.match(textOf(rows[1]!), /Keyboard shortcuts/);
  await act(async () => tree!.unmount());
});
