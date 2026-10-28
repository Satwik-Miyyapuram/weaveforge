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
      onTogglePreview={() => {}}
      onSplit={() => {}}
      onToggleFocus={() => {}}
    />,
  );

/** The opening tag of the button named `label`. */
const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";

test("the toolbar holds the focused document's tools, then preview, split and focus, never the mode", () => {
  const html = render(openTab(emptyLayout(), { kind: "note", id: "n1" }));
  assert.match(html, /role="toolbar"/);
  assert.doesNotMatch(html, /aria-label="Mode"/, "the mode lives in the note's path row");
  assert.match(html, />Image n1</);
  for (const label of ["Preview", "Split right", "Split down", "Focus"]) assert.ok(button(html, label), label);
  assert.match(button(html, "Preview"), /aria-pressed="false"/, "no preview open yet");
  assert.match(html.slice(html.indexOf("workspace-toolbar-end")), /aria-label="Preview"/, "Preview sits with the layout icons");
});

test("Preview is pressed while the preview pane is open", () => {
  const html = render(togglePreview(openTab(emptyLayout(), { kind: "note", id: "n1" }), "pane-2"));
  assert.match(button(html, "Preview"), /aria-pressed="true"/);
});

test("with no document, the controls are greyed, not gone", () => {
  const html = render(emptyLayout());
  assert.match(html, /disabled=""[^>]*>Image none</);
  assert.match(button(html, "Preview"), /disabled=""/);
});

test("the toolbar keeps its layout icons in Ink; Preview greys there", () => {
  for (const tab of [{ kind: "vault_page", id: "n1", mode: "ink" }, { kind: "paper_pdf", id: "p1" }] as const) {
    const html = render(openTab(emptyLayout(), tab));
    assert.doesNotMatch(html, /aria-label="Mode"/);
    assert.match(button(html, "Preview"), /disabled=""/, tab.kind);
    assert.ok(button(html, "Split right"), tab.kind);
  }
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

test("in focus the toolbar hides, so a document keeps its own bar in the pane", async () => {
  const { PaneView } = await import("../ui/pane-view");
  const { ToolbarSlot } = await import("@/components/toolbar-slot");
  const noop = () => {};
  const view = (focus: boolean) =>
    renderToStaticMarkup(
      <PaneView
        focus={focus}
        layout={openTab(emptyLayout(), { kind: "note", id: "n1" })}
        labelFor={() => "Note"}
        renderDocument={() => (
          <ToolbarSlot>
            <i className="doc-bar">bar</i>
          </ToolbarSlot>
        )}
        onActivate={noop}
        onClose={noop}
        onFocus={noop}
        onSplit={noop}
        onDropTab={noop}
        onRatio={noop}
        onSetMode={noop}
        onTogglePreview={noop}
      />,
    );
  assert.match(view(true), /<div class="pane-document"><i class="doc-bar">/);
  // Out of focus the bar belongs to the toolbar's slot, never the pane.
  assert.doesNotMatch(view(false), /pane-document"><i class="doc-bar"/);
});

test("the PDF reader's bar goes up to the toolbar too, as one flat row", () => {
  const reader = readFileSync(fileURLToPath(new URL("../../reader/ui/pdf-reader/pdf-reader.tsx", import.meta.url)), "utf8");
  // In its own focus the reader floats the palette over the page, so it stays put.
  assert.match(reader, /<ToolbarSlot inline=\{focus\}>\s*<div className="pdf-reader-chrome"/);
  const css = readFileSync(fileURLToPath(new URL("../../../app/styles/editor-workspace.css", import.meta.url)), "utf8");
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `missing ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };
  assert.match(rule(".workspace-toolbar-doc > .pdf-reader-chrome"), /flex-wrap: nowrap/);
  assert.match(rule(".workspace-toolbar-doc .pdf-reader-tools"), /flex-wrap: nowrap/);
  // The toolbar has its own Focus.
  assert.match(rule(".workspace-toolbar-doc .pdf-reader-focus-btn"), /display: none/);
});

test("the mode switch sits in the note's path row in every mode, so it never moves", async () => {
  const ink = openTab(emptyLayout(), { kind: "vault_page", id: "n1", mode: "ink" });
  const text = openTab(emptyLayout(), { kind: "vault_page", id: "n1" });
  const pdf = openTab(emptyLayout(), { kind: "paper_pdf", id: "p1" });
  const { PaneView } = await import("../ui/pane-view");
  const noop = () => {};
  const pane = (layout: PaneLayout) =>
    renderToStaticMarkup(
      <PaneView
        layout={layout}
        labelFor={() => "Note"}
        crumbsFor={() => [{ label: "Notes" }, { label: "Note", current: true }]}
        renderDocument={() => null}
        onActivate={noop}
        onClose={noop}
        onFocus={noop}
        onSplit={noop}
        onDropTab={noop}
        onRatio={noop}
        onSetMode={noop}
        onTogglePreview={noop}
      />,
    );
  const crumbRow = (html: string) => html.slice(html.indexOf('class="pane-crumbs"'), html.indexOf('class="pane-body-wrap"'));
  for (const layout of [ink, text, pdf]) {
    const row = crumbRow(pane(layout));
    assert.match(row, /aria-label="Mode"/);
    assert.doesNotMatch(row, /Preview/, "Preview is in the toolbar, not the path row");
  }
  assert.match(button(crumbRow(pane(text)), "Text"), /aria-pressed="true"/);
  assert.match(button(crumbRow(pane(ink)), "Ink"), /aria-pressed="true"/);
});
