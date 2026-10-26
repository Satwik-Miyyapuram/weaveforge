/**
 * An ink note read as its sheet shows `[[links]]` as links, like any note's
 * Read view, and its typed text is not hidden under a placed figure (design
 * D19, DA-101).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { InkSheetTextUnderlay } from "../ui/ink-sheet-underlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

function underlayHtml(props: Parameters<typeof InkSheetTextUnderlay>[0]): string {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(createElement(InkSheetTextUnderlay, props));
  });
  const html = (tree.root.findByType("div").props.dangerouslySetInnerHTML as { __html: string }).__html;
  act(() => tree.unmount());
  return html;
}

test("a wikilink on the sheet renders as a link, not its brackets", () => {
  const html = underlayHtml({
    text: "See [[Cluster cheat-sheet]]",
    scale: 1,
    resolveWikilink: () => ({ href: "/notes?page=n1", unresolved: false }),
  });
  assert.match(html, /<a class="wikilink" href="\/notes\?page=n1" data-wikilink="1">Cluster cheat-sheet<\/a>/);
  assert.doesNotMatch(html, /\[\[/);
});

test("the read sheet resolves links against the note catalogue", () => {
  const reader = src("../ui/ink-reader.tsx");
  assert.match(reader, /useWikilinkNavigation\(/);
  assert.match(reader, /resolveWikilink=\{resolveWikilink\}/);
  assert.match(src("../ui/ink-page-static.tsx"), /resolveWikilink=\{resolveWikilink\}/);
});

test("typed text paints above a placed figure, on the read sheet and the editor", () => {
  for (const file of ["../ui/ink-page-static.tsx", "../ui/ink-host.tsx"]) {
    const s = src(file);
    const figures = s.indexOf("<InkFigures");
    const text = s.indexOf("<InkSheetTextUnderlay");
    assert.ok(figures > 0 && text > figures, `${file}: text is drawn under the figures`);
  }
});
