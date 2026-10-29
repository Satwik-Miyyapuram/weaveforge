import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReadingList, ReadingListItem } from "@weaveforge/core";

import { toasts } from "@/lib/toast/toast-store";
import { ListItemActions, ListNode, listKey } from "../ui/list-node";

/** A list's items in the tree view: each row can be moved by button (36-06). */
function item(id: string, paperId: string, sortOrder: number): ReadingListItem {
  return { id, listId: "l1", paperId, sortOrder } as ReadingListItem;
}

function render(items: ReadingListItem[], readOnly = false) {
  const list = { id: "l1", name: "Core", sortOrder: 0, createdAt: "" } as ReadingList;
  return renderToStaticMarkup(
    <ListNode
      node={{ list, children: [] }}
      depth={0}
      isCollapsed={false}
      readOnly={readOnly}
      papers={[]}
      notes={[]}
      paperTitles={new Map([["p1", "First"], ["p2", "Second"]])}
      noteTitles={new Map()}
      listNames={new Map()}
      itemsByList={new Map([["l1", items]])}
      collapsedSet={new Set()}
      onToggleCollapse={() => {}}
      onChanged={() => {}}
      onReload={() => {}}
    />,
  );
}

const buttons = (html: string, label: string) =>
  [...html.matchAll(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`, "g"))].map((m) => m[0]);

test("an item's actions: move up, move down and remove; the ends cannot move further", () => {
  const row = (isFirst: boolean, isLast: boolean) =>
    renderToStaticMarkup(
      <ListItemActions isFirst={isFirst} isLast={isLast} onMove={() => {}} onRemove={() => {}} />,
    );
  const first = row(true, false);
  assert.match(buttons(first, "Move up")[0]!, /disabled/);
  assert.doesNotMatch(buttons(first, "Move down")[0]!, /disabled/);
  assert.equal(buttons(first, "Remove from list").length, 1);
  const last = row(false, true);
  assert.doesNotMatch(buttons(last, "Move up")[0]!, /disabled/);
  assert.match(buttons(last, "Move down")[0]!, /disabled/);
  const only = row(true, true);
  assert.match(buttons(only, "Move up")[0]!, /disabled/);
  assert.match(buttons(only, "Move down")[0]!, /disabled/);
});

test("a read-only list shows no item buttons", () => {
  const html = render([item("i1", "p1", 0)], true);
  assert.equal(buttons(html, "Move up").length, 0);
  assert.equal(buttons(html, "Remove from list").length, 0);
  assert.match(html, /First/);
});

test("a deleted list disappears at once and comes back on Undo (D-07)", () => {
  assert.match(render([item("i1", "p1", 0)], true), /Core/);
  toasts.deferDelete({ keys: [listKey("l1")], message: "x", commit: () => {} });
  assert.equal(render([item("i1", "p1", 0)], true), "");
  toasts.undoLatest();
  assert.match(render([item("i1", "p1", 0)], true), /Core/);
});

test("the move buttons draw arrow icons like the remove button, not text glyphs", () => {
  // A text arrow sits on the font's baseline, off the icon line the unlink
  // icon beside it uses.
  const html = renderToStaticMarkup(
    <ListItemActions isFirst={false} isLast={false} onMove={() => {}} onRemove={() => {}} />,
  );
  assert.doesNotMatch(html, /[↑↓]/);
  assert.equal(html.match(/<svg/g)?.length, 3);
});
