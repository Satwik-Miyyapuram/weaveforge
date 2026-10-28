/**
 * In the Editor a document's own tools (the ink bar) sit in the one toolbar on
 * top, not in a bar per pane. Only the focused document's tools show there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { ToolbarSlot, ToolbarSlotContext } from "../toolbar-slot";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

test("outside the Editor the tools render where they are", () => {
  assert.equal(renderToStaticMarkup(<ToolbarSlot><b>bar</b></ToolbarSlot>), "<b>bar</b>");
});

test("in the Editor, a document that is not focused shows no tools of its own", () => {
  const html = renderToStaticMarkup(
    <ToolbarSlotContext.Provider value={null}>
      <ToolbarSlot><b>bar</b></ToolbarSlot>
    </ToolbarSlotContext.Provider>,
  );
  assert.equal(html, "");
});

test("the ink note's bar goes through the slot, and the panes hand it only to the focused document", () => {
  assert.match(read("features/ink/ui/ink-host.tsx"), /<ToolbarSlot>\s*<InkBar/);
  const pane = read("features/editor-workspace/ui/pane-view.tsx");
  assert.match(pane, /<ToolbarSlotContext\.Provider value=\{focused && shown \? slot : null\}>/);
  assert.match(read("features/editor-workspace/ui/workspace-toolbar.tsx"), /className="workspace-toolbar-doc" ref=\{slotRef\}/);
});
