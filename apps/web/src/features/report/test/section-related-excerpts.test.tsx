/**
 * The Zotero annotations beside a section note fold away: an empty panel was a
 * permanent box beside every note, and a full one pushed the note's width down.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReportSection } from "@weaveforge/core";

import { SectionRelatedExcerpts } from "../ui/section-related-excerpts";

const section = { id: "s1", title: "Introduction" } as ReportSection;

test("the annotations panel is a collapsible disclosure, closed while empty", () => {
  const html = renderToStaticMarkup(createElement(SectionRelatedExcerpts, { section, onInsert: () => {} }));
  assert.match(html, /^<details class="section-excerpts"/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  assert.match(html, /<summary[^>]*>Zotero annotations/);
  assert.match(html, /No Zotero annotations pinned to this section\./);
});

test("the panel shows in Edit too, where Insert lands at the caret (DA-106)", () => {
  const src = readFileSync(fileURLToPath(new URL("../ui/section-note.tsx", import.meta.url)), "utf8");
  assert.match(src, /\{!readOnly && <SectionRelatedExcerpts\b/);
  assert.doesNotMatch(src, /!editing && <SectionRelatedExcerpts/);
});
