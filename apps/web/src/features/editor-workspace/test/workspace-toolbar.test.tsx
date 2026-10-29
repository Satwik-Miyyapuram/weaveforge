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
      onInsertImage={() => {}}
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
  assert.ok(button(html, "Insert"), "Insert (a picture) is in the one bar");
  assert.doesNotMatch(button(html, "Insert"), /disabled=""/);
  assert.doesNotMatch(html, /aria-label="Add image"/, "the image button merged into Insert");
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
  assert.match(button(html, "Insert"), /disabled=""/);
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

test("one toolbar in every mode: Text greys the ink tools, Ink greys the text tools", () => {
  const text = render(openTab(emptyLayout(), { kind: "note", id: "n1" }));
  const idle = text.slice(text.indexOf("workspace-toolbar-idle"));
  assert.match(idle, /aria-label="Page controls"/, "the one bar shows in Text, greyed");
  assert.match(button(idle, "Select \\(V\\)"), /disabled=""/, "the greyed bar has the same tools as the live one");
  assert.doesNotMatch(button(idle, "Insert"), /disabled=""/, "Insert works in Text");
  assert.doesNotMatch(text, /<fieldset/, "greyed per control, not by a fieldset");
  for (const tab of [{ kind: "vault_page", id: "n1", mode: "ink" }, { kind: "paper_pdf", id: "p1" }] as const) {
    const ink = render(openTab(emptyLayout(), tab));
    assert.doesNotMatch(ink, /workspace-toolbar-idle/, `${tab.kind}: the live ink bar takes the slot`);
  }
});

test("the active tab is marked by more than its text colour, and the colours have room", () => {
  const css = readFileSync(fileURLToPath(new URL("../../../app/styles/editor-workspace.css", import.meta.url)), "utf8");
  assert.match(css, /\.pane-tab-slot:has\(> \.wf-tab\[aria-selected="true"\]\) \{[^}]*background: var\(--surface\);[^}]*box-shadow: inset 0 -3px 0 var\(--accent\);/);
  assert.match(css, /\.workspace-toolbar-doc \.ink-quick-colours \{\s*gap: var\(--s3\);/);
  assert.match(
    css,
    /\.workspace-toolbar-doc:not\(:empty\) \+ \.workspace-toolbar-idle \{\s*display: none;/,
    "a PDF's live bar replaces the greyed one",
  );
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

test("in the toolbar the ink bar is flat and never scrolls: a narrow pane folds into More", () => {
  const css = readFileSync(fileURLToPath(new URL("../../../app/styles/editor-workspace.css", import.meta.url)), "utf8");
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `missing ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };
  const bar = rule(".workspace-toolbar-doc > .ink-bar");
  assert.match(bar, /flex-wrap: nowrap/);
  assert.doesNotMatch(bar, /overflow-x/);
  assert.match(rule(".workspace-toolbar-doc :is(.ink-bar-group, .ink-page-pill)"), /border: 0/);
  assert.match(rule(".workspace-toolbar-doc :is(.ink-bar-group, .ink-page-pill)"), /flex-wrap: nowrap/);
  // Nothing in the toolbar scrolls sideways, so nothing needs to stick.
  assert.doesNotMatch(css, /\.workspace-toolbar-doc[^{]*\{[^}]*overflow-x: auto/);
  assert.doesNotMatch(css, /\.workspace-toolbar-doc \.ink-menu-more \{[^}]*position: sticky/);
});

test("the focus palette docked top or bottom wraps rather than scrolls", () => {
  const css = readFileSync(fileURLToPath(new URL("../../../app/styles/editor-workspace.css", import.meta.url)), "utf8");
  const at = css.indexOf("the palette runs as a row");
  assert.ok(at >= 0);
  const body = css.slice(at, css.indexOf("}", at));
  assert.match(body, /flex-wrap: wrap/);
  assert.doesNotMatch(body, /overflow-x/);
});

test("the read-only sheet's bar, the one bar greyed, also goes up to the toolbar", () => {
  const reader = readFileSync(fileURLToPath(new URL("../../ink/ui/ink-reader.tsx", import.meta.url)), "utf8");
  assert.match(reader, /<ToolbarSlot>\s*<InkBar\b/);
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

test("the PDF reader's bar goes up to the toolbar too, folding rather than scrolling", () => {
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
  assert.match(rule(".workspace-toolbar-doc .pdf-reader-chrome .ink-bar"), /flex-wrap: nowrap/);
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

test("the bar folds rather than wraps: a Layout ▾ holds Preview and Split once it is narrow", () => {
  const html = render(openTab(emptyLayout(), { kind: "note", id: "n1" }));
  const end = html.slice(html.indexOf("workspace-toolbar-end"));
  const layout = button(end, "Layout");
  assert.ok(layout, "Layout ▾ waits in the layout group");
  assert.match(layout, /aria-haspopup="menu"/);
  assert.match(end.slice(end.indexOf('aria-label="Layout"')), /ink-menu-caret/, "a caret, like Insert");
  assert.match(button(html, "Find in document"), /wf-ghost/, "Find is a ghost button");
  const css = readFileSync(fileURLToPath(new URL("../../../app/styles/editor-workspace.css", import.meta.url)), "utf8");
  assert.match(css, /\.workspace-toolbar-layout \{[^}]*display: none;/, "Layout ▾ is hidden until the fold needs it");
  assert.match(css, /\.workspace-toolbar\[data-fold~="layout"\] \.workspace-toolbar-layout/);
  assert.match(css, /\.workspace-toolbar\[data-fold~="colours"\] \.workspace-toolbar-doc \.ink-quick-colours/);
  assert.match(css, /\.workspace-toolbar\[data-moved\] \.workspace-toolbar-doc \.ink-menu-more::after/, "a dot on More once something moved");
  assert.match(css, /\.workspace-toolbar-doc > \.ink-bar \{[^}]*flex-wrap: nowrap;/, "never wraps");
});
