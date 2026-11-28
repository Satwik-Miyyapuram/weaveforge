/**
 * A large vault paints only a window of its rows (M04).
 *
 * Every row used to be painted, a dozen elements each, almost all of them
 * scrolled out of sight. Before the panel is measured it paints the first
 * screenful; the rest stand in as one gap of the same height, so the
 * scrollbar is unchanged.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ExplorerPanel } from "../ui/explorer-panel";
import { EXPLORER_FIRST_PAINT_ROWS, EXPLORER_ROW_PX } from "../ui/explorer-window-constants";
import type { WorkspaceTreeNode } from "@weaveforge/wasm";
import { loadTestCore } from "@/lib/test/load-test-core";

before(loadTestCore);

function files(n: number): WorkspaceTreeNode[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `vault_page:${i}`,
    kind: "vault_page",
    id: String(i),
    label: `Note ${i}`,
    path: `notes/note-${i}.md`,
    children: [],
  }));
}

function render(n: number, activeKey?: string): string {
  return renderToStaticMarkup(
    createElement(ExplorerPanel, {
      sections: [{ id: "files", title: "Files", tree: files(n) }],
      onOpen: () => {},
      activeKey,
    }),
  );
}

const treeitems = (html: string) => html.match(/role="treeitem"/g)?.length ?? 0;

test("2,000 files paint a first screenful, not 2,000 rows", () => {
  const html = render(2_000);
  assert.equal(treeitems(html), EXPLORER_FIRST_PAINT_ROWS);
  assert.ok(html.includes(`height:${(2_000 - EXPLORER_FIRST_PAINT_ROWS) * EXPLORER_ROW_PX}px`));
  assert.ok(html.includes(">2000<"), "the section count still counts every file");
});

test("the open note's row is painted even when it sits below the first screenful", () => {
  // A note just made lands at the end of a long folder; its row must exist to be shown.
  const html = render(2_000, "vault_page:1999");
  assert.equal(treeitems(html), EXPLORER_FIRST_PAINT_ROWS + 1);
  assert.match(html, /data-row-key="vault_page:1999"/);
});

test("a small vault paints every row and no gap", () => {
  const html = render(5);
  assert.equal(treeitems(html), 5);
  assert.ok(!/style="height:\d+px"/.test(html));
});

test("a row shows its title, not its .note.md suffix, and names itself when cut (DA-32)", () => {
  const html = render(1);
  assert.doesNotMatch(html, /\.note\.md|explorer-ext/);
  assert.match(html, /<span class="explorer-label" title="Note 0">Note 0<\/span>/);
});
