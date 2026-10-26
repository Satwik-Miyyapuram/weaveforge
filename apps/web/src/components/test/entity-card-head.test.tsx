/** Status sits in line with the title; the title keeps a floor width and the controls wrap under as one unit (D09, E42). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { EntityCard } from "../entity-card";

const css = () => readFileSync(fileURLToPath(new URL("../../app/styles/entity-cards.css", import.meta.url)), "utf8");
const rule = (sel: string) => {
  const s = css();
  const i = s.indexOf(`${sel} {`);
  assert.ok(i >= 0, `missing rule ${sel}`);
  return s.slice(i, s.indexOf("}", i));
};

test("badge, status, actions and ⋯ sit in the head, after the title (E42)", () => {
  const html = renderToStaticMarkup(
    <EntityCard
      title="A very long paper title"
      leading={<span className="lead-x" />}
      badge={<span className="badge-x">Shared</span>}
      status={<span className="status-x">Reading</span>}
      actions={<span className="actions-x">2</span>}
      menu={<button type="button" className="menu-x">⋯</button>}
    />,
  );
  const headStart = html.indexOf('class="entity-card-head"');
  const metaOrEnd = html.indexOf("</article>") > 0 ? html.indexOf("</article>") : html.length;
  const head = html.slice(headStart, metaOrEnd);
  const order = ["lead-x", "entity-card-title", "badge-x", "status-x", "actions-x", "menu-x"].map((c) => head.indexOf(c));
  for (const i of order) assert.ok(i > 0, html);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "order lead, title, badge, status, actions, ⋯");
  // One cluster inside the head, no separate row below it.
  assert.equal(html.match(/class="entity-card-controls"/g)?.length, 1);
  assert.ok(html.indexOf('class="entity-card-controls"') > headStart);
});

test("the title keeps a floor width; the controls wrap under it as one unit", () => {
  assert.match(rule(".entity-card-head"), /flex-wrap: wrap/);
  assert.match(rule(".entity-card-head > .entity-card-title"), /flex: 1 1 \d+ch/);
  const c = rule(".entity-card-controls");
  assert.match(c, /flex: none/);
  assert.match(c, /margin-left: auto/);
  assert.doesNotMatch(c, /margin-top/);
  assert.doesNotMatch(css(), /\.entity-card-controls > \.entity-card-status \{ margin-right: auto/);
});

test("a card with nothing but a title draws no controls", () => {
  const html = renderToStaticMarkup(<EntityCard title="Note" />);
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
