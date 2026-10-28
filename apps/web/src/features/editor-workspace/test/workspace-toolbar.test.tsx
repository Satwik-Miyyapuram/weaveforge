/**
 * The Editor has one toolbar, over every pane, acting on the focused one. The
 * pane headers used to carry their own Edit / Read / Ink buttons plus the
 * split and focus icons, crammed into each tab strip.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { emptyLayout, openTab, togglePreview, type PaneLayout } from "../application/pane-tree";
import { WorkspaceToolbar } from "../ui/workspace-toolbar";

const render = (layout: PaneLayout) =>
  renderToStaticMarkup(
    <WorkspaceToolbar
      layout={layout}
      renderTools={(tab, enabled) => <button disabled={!enabled}>Image {tab ? tab.id : "none"}</button>}
      onSetMode={() => {}}
      onTogglePreview={() => {}}
      onSplit={() => {}}
      onToggleFocus={() => {}}
    />,
  );

test("the toolbar holds the focused document's mode, its tools, then split and focus", () => {
  const html = render(openTab(emptyLayout(), { kind: "note", id: "n1" }));
  assert.match(html, /role="toolbar"/);
  assert.match(html, /aria-label="Mode"/);
  assert.match(html, />Image n1</);
  for (const label of ["Split right", "Split down", "Focus"]) assert.match(html, new RegExp(`aria-label="${label}"`));
  assert.match(html, /aria-pressed="false"[^>]*>Split</, "no preview open yet");
});

test("Split is pressed while the preview pane is open", () => {
  const html = render(togglePreview(openTab(emptyLayout(), { kind: "note", id: "n1" }), "pane-2"));
  assert.match(html, /aria-pressed="true"[^>]*>Split</);
});

test("with no document, the controls are greyed, not gone", () => {
  const html = render(emptyLayout());
  assert.match(html, /aria-label="Mode"/);
  assert.match(html, /disabled=""[^>]*>Image none</);
  assert.match(html, /disabled=""[^>]*>Text</);
});

test("a pane header no longer carries its own mode switch or layout buttons", () => {
  const pane = readFileSync(fileURLToPath(new URL("../ui/pane-view.tsx", import.meta.url)), "utf8");
  assert.doesNotMatch(pane, /<DocumentModeSwitch|label="Split right"|label="Focus"/);
  assert.match(pane, /<WorkspaceToolbar/);
});

test("the preview's breadcrumbs are its source's path, not Untitled", () => {
  const screen = readFileSync(fileURLToPath(new URL("../ui/workspace-screen.tsx", import.meta.url)), "utf8");
  assert.match(screen, /const shown = isPreviewTab\(tab\) \? previewOf : tab;/);
});

test("the ink bar has no loose separators: they dangled at line ends once the bar wrapped", () => {
  const bar = readFileSync(fileURLToPath(new URL("../../ink/ui/ink-bar.tsx", import.meta.url)), "utf8");
  const css = readFileSync(fileURLToPath(new URL("../../../app/styles/editor-workspace.css", import.meta.url)), "utf8");
  assert.doesNotMatch(bar, /ink-sep/);
  assert.doesNotMatch(css, /\.ink-sep\b/);
});

test("in the toolbar the ink bar is one flat row: no wrap, no boxed groups", () => {
  const css = readFileSync(fileURLToPath(new URL("../../../app/styles/editor-workspace.css", import.meta.url)), "utf8");
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `missing ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };
  assert.match(rule(".workspace-toolbar-doc > .ink-bar"), /flex-wrap: nowrap/);
  assert.match(rule(".workspace-toolbar-doc :is(.ink-bar-group, .ink-page-pill)"), /border: 0/);
  assert.match(rule(".workspace-toolbar-doc .ink-menu-more"), /position: sticky/);
  assert.match(rule(".workspace-toolbar-doc .ink-bar > .wf-btn:not(:disabled) > span"), /display: none/);
});

test("the read-only sheet's page and zoom bar also goes up to the toolbar", () => {
  const reader = readFileSync(fileURLToPath(new URL("../../ink/ui/ink-reader.tsx", import.meta.url)), "utf8");
  assert.match(reader, /<ToolbarSlot>\s*<div className="ink-reader-bar">/);
});
