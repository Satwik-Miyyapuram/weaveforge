/**
 * A note, a paper note and a report section outside the Editor carry the same
 * one bar the Editor does: their mode switch, then the bar, in one strip. No
 * screen keeps a toolbar row of its own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { FOLD_STAGES } from "@/features/ink/ui/ink-bar-fold";
import { DocumentToolbar, citeAsSection } from "../document-toolbar";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const EDITORS = [
  "../../features/vault/ui/vault-screen/page-editor.tsx",
  "../../features/papers/ui/paper-note.tsx",
  "../../features/report/ui/section-note.tsx",
];

for (const rel of EDITORS) {
  test(`${rel.split("/").pop()} draws the one bar, not a row of its own`, () => {
    const code = src(rel);
    assert.match(code, /<DocumentToolbar\b/);
    assert.match(code, /lead=\{[\s\S]*?<DocumentModeSwitch/, "the mode switch leads the strip");
    assert.doesNotMatch(code, /summary-editor-bar|AttachImageButton|CitationFormatSelect/);
  });
}

test("the report's artifact goes in Insert and its citation format in More", () => {
  const code = src("../../features/report/ui/section-note.tsx");
  assert.match(code, /insertItems=\{[\s\S]*?Experiment figure or table…/);
  assert.match(code, /moreSections=\{[\s\S]*?citeAsSection\(/);
});

test("the paper note's citation format and refresh go in More", () => {
  const code = src("../../features/papers/ui/paper-note.tsx");
  assert.match(code, /moreSections=\{[\s\S]*?citeAsSection\([\s\S]*?Refresh paper details/);
});

test("the strip is lead, the slot a live bar portals into, then the greyed bar", () => {
  const html = renderToStaticMarkup(
    <DocumentToolbar lead={<b>mode</b>} editor={{ current: null }} onError={() => undefined}>
      <p>body</p>
    </DocumentToolbar>,
  );
  assert.match(
    html,
    /^<div class="document-toolbar"[^>]*><b>mode<\/b><span class="workspace-toolbar-doc"><\/span><span class="workspace-toolbar-doc workspace-toolbar-idle">/,
  );
  assert.match(html, /<p>body<\/p>$/);
  assert.doesNotMatch(html.match(/<button[^>]*aria-label="Insert"[^>]*>/)?.[0] ?? "", /disabled=""/, "Insert takes a picture");
});

test("the strip folds like the Editor's bar instead of clipping", () => {
  assert.match(src("../document-toolbar.tsx"), /useToolbarFold\(/);
  const css = src("../../app/styles/entity-detail.css");
  assert.match(css, /\.document-toolbar \{[^}]*overflow: hidden;/);
  const fold = src("../../app/styles/editor-workspace.css");
  assert.doesNotMatch(fold, /(?<!, )\.workspace-toolbar\[data-(fold|moved)/, "every fold rule covers both bars");
  assert.doesNotMatch(src("../../features/ink/ui/ink-bar-fold.tsx"), /closest[^(]*\("\.workspace-toolbar"\)/);
});

test("in ink focus the strip steps aside; the sheet keeps its bar", () => {
  const html = renderToStaticMarkup(
    <DocumentToolbar focus onError={() => undefined}>
      <p>body</p>
    </DocumentToolbar>,
  );
  assert.equal(html, "<p>body</p>");
});

test("Cite as is one radio per format, the current one checked", () => {
  const picked: string[] = [];
  const section = citeAsSection("latex", (f) => picked.push(f));
  assert.equal(section.label, "Cite as");
  assert.deepEqual(section.items.filter((i) => i.checked).map((i) => i.label), ["LaTeX \\cite{}"]);
  section.items[0]!.onSelect();
  assert.deepEqual(picked, ["wikilink"]);
});

test("a too-narrow strip folds and wraps again after focus toggles off and on", () => {
  const g = globalThis as Record<string, unknown>;
  (g as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const names = ["ResizeObserver", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame"];
  const saved = names.map((name) => [name, g[name]] as const);
  class Idle {
    observe() {}
    disconnect() {}
  }
  Object.assign(g, { ResizeObserver: Idle, MutationObserver: Idle, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} });
  const bars: Record<string, string | undefined>[] = [];
  // Always 200px wide against a 100px bar: nothing fits, so the fold runs out and it wraps.
  const node = (type: string) => {
    if (type !== "div") return null;
    const dataset: Record<string, string | undefined> = {};
    bars.push(dataset);
    return { dataset, clientWidth: 100, scrollWidth: 200, querySelector: () => null };
  };
  const view = (focus: boolean) => (
    <DocumentToolbar focus={focus} onError={() => undefined}>
      <p>body</p>
    </DocumentToolbar>
  );
  try {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(view(false), { createNodeMock: (element) => node(String(element.type)) });
    });
    act(() => {
      tree.update(view(true));
    });
    act(() => {
      tree.update(view(false));
    });
    assert.equal(bars.length, 2);
    assert.equal(bars[1]!.fold, FOLD_STAGES.join(" "));
    assert.equal(bars[1]!.wrap, "");
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete g[name];
      else g[name] = value;
    }
  }
});
