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
  assert.match(code, /insertItems=\{[\s\S]*?Experiment artifact…/);
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
