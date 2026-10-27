/** Status and ⋯ float top-right in the head; the title text wraps around them (D09, E42). */
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

test("badge, status, actions and ⋯ sit in the head, before the title so it flows around them (E42)", () => {
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
  const order = ["lead-x", "badge-x", "status-x", "actions-x", "menu-x", "entity-card-title"].map((c) => head.indexOf(c));
  for (const i of order) assert.ok(i > 0, html);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "order lead, badge, status, actions, ⋯, title");
  // One cluster inside the head, no separate row below it.
  assert.equal(html.match(/class="entity-card-controls[ "]/g)?.length, 1);
  assert.ok(html.indexOf('class="entity-card-controls') > headStart);
});

test("the controls float right and the title wraps around them", () => {
  const head = rule(".entity-card-head");
  assert.match(head, /display: flow-root/);
  assert.doesNotMatch(head, /flex-wrap/);
  assert.match(rule(".entity-card-head > .entity-card-title"), /display: block/);
  assert.doesNotMatch(css(), /\.entity-card-head > \.entity-card-title \{[^}]*flex: 1 1 \d+ch/);
  const c = rule(".entity-card-controls");
  assert.match(c, /float: right/);
  assert.match(c, /display: flex/);
  assert.match(rule(".entity-card-lead"), /float: left/);
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
  assert.equal(html.match(/class="wf-chip"/g)?.length, 3);
  assert.match(html, /chip-more">\+2</);
});

test("a card tag chip cut by its ellipsis names itself on hover (DA-27)", () => {
  const html = renderToStaticMarkup(<EntityCard title="x" tags={["a-very-long-tag-name"]} />);
  assert.match(html, /<span title="#a-very-long-tag-name" class="wf-chip">/);
});

test("a lists rail name cut by its ellipsis names itself on hover (DA-31)", () => {
  const src = readFileSync(fileURLToPath(new URL("../../features/reading-lists/ui/lists-rail.tsx", import.meta.url)), "utf8");
  assert.match(src, /<span className="lists-rail-name" title=\{r\.list\.name\}>/);
});

test("the leading control sits in its own box, so a control reset cannot eat the gap to the title", () => {
  // states.css resets every checkbox to margin 0 at a higher specificity, which
  // erased the 8px between a milestone's check and its title.
  const html = renderToStaticMarkup(<EntityCard title="Thesis" leading={<input type="checkbox" className="wf-check" />} />);
  assert.match(html, /<div class="entity-card-lead"><input type="checkbox" class="wf-check"\/><\/div>/);
  // 12px, not 8: the brutal check casts a 3px hard shadow into the gap, so 8px read as touching.
  assert.match(rule(".entity-card-lead"), /margin-right: 12px/);
  assert.doesNotMatch(css(), /:first-child:not\(\.entity-card-controls\)/);
});

test("only a trailing ⋯ pulls the controls into the card's edge; a text badge keeps its inset", () => {
  const withMenu = renderToStaticMarkup(<EntityCard title="x" menu={<button type="button">⋯</button>} />);
  assert.match(withMenu, /class="entity-card-controls entity-card-controls--menu"/);
  const badgeOnly = renderToStaticMarkup(<EntityCard title="x" badge={<span>Create note</span>} />);
  assert.match(badgeOnly, /class="entity-card-controls"/);
  assert.doesNotMatch(rule(".entity-card-controls"), /margin-right: -/);
  assert.match(rule(".entity-card-controls--menu"), /margin-right: -8px/);
});

test("an openable card is not a fake button: its title is the catalogue link button", () => {
  const open = renderToStaticMarkup(<EntityCard title="Thesis" onActivate={() => {}} />);
  assert.doesNotMatch(open, /role="button"|tabindex/);
  assert.match(open, /^<div class="card entity-card" role="presentation">/);
  assert.match(open, /<h3 class="entity-card-title"><button type="button" class="wf-link">Thesis<\/button><\/h3>/);
  // A card nobody opens keeps a plain title.
  const still = renderToStaticMarkup(<EntityCard title="Thesis" />);
  assert.match(still, /<h3 class="entity-card-title">Thesis<\/h3>/);
  assert.doesNotMatch(still, /role=/);
});
