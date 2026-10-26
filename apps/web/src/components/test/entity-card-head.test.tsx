/** The card head holds only the title and ⋯, so the title gets the width (D09, DA-24, DA-26). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { EntityCard } from "../entity-card";

const head = (html: string) => html.match(/<div class="entity-card-head">([\s\S]*?)<\/div><div class="entity-card-controls"|<div class="entity-card-head">([\s\S]*)$/);

test("status, badge and actions sit under the title, not beside it", () => {
  const html = renderToStaticMarkup(
    <EntityCard
      title="A very long paper title"
      badge={<span className="badge-x">Shared</span>}
      status={<span className="status-x">Reading</span>}
      actions={<span className="actions-x">2</span>}
      menu={<button type="button" className="menu-x">⋯</button>}
    />,
  );
  const m = head(html);
  assert.ok(m, html);
  const inHead = m[1] ?? "";
  assert.match(inHead, /entity-card-title/);
  assert.match(inHead, /menu-x/);
  for (const cls of ["badge-x", "status-x", "actions-x"]) assert.doesNotMatch(inHead, new RegExp(cls));
  const controls = html.slice(html.indexOf('class="entity-card-controls"'));
  for (const cls of ["badge-x", "status-x", "actions-x"]) assert.match(controls, new RegExp(cls));
});

test("a card with no status or badge draws no controls row", () => {
  const html = renderToStaticMarkup(<EntityCard title="Note" menu={<button type="button">⋯</button>} />);
  assert.doesNotMatch(html, /entity-card-controls/);
});

test("a long single-word title breaks instead of overflowing", () => {
  const css = readFileSync(fileURLToPath(new URL("../../app/styles/entity-cards.css", import.meta.url)), "utf8");
  const rule = css.slice(css.indexOf(".entity-card-title,"), css.indexOf("}", css.indexOf(".entity-card-title,")));
  assert.match(rule, /overflow-wrap: break-word/);
  assert.doesNotMatch(css, /\.entity-card-actions \{\s*float: right/);
});

test("more than three tags fold into +n", () => {
  const html = renderToStaticMarkup(<EntityCard title="x" tags={["a", "b", "c", "d", "e"]} />);
  assert.equal(html.match(/class="tag-chip"/g)?.length, 3);
  assert.match(html, /chip-more">\+2</);
});

test("a card tag chip cut by its ellipsis names itself on hover (DA-27)", () => {
  const html = renderToStaticMarkup(<EntityCard title="x" tags={["a-very-long-tag-name"]} />);
  assert.match(html, /<span class="tag-chip" title="#a-very-long-tag-name">/);
});

test("a lists rail name cut by its ellipsis names itself on hover (DA-31)", () => {
  const src = readFileSync(fileURLToPath(new URL("../../features/reading-lists/ui/lists-rail.tsx", import.meta.url)), "utf8");
  assert.match(src, /<span className="lists-rail-name" title=\{r\.list\.name\}>/);
});
