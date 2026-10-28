/** One ViewSwitch for every pick-a-view tab strip (design D02). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ViewSwitch } from "../view-switch";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("the chosen view is the selected tab and marked seg-on", () => {
  const out = html(
    <ViewSwitch label="View" value="list" onChange={() => {}} options={[{ value: "cards", label: "Cards" }, { value: "list", label: "List" }]} />,
  );
  assert.match(out, /^<div class="seg view-switch" role="tablist" aria-label="View">/);
  assert.match(out, /<button type="button" role="tab" aria-selected="false">Cards<\/button>/);
  assert.match(out, /<button type="button" role="tab" aria-selected="true" class="seg-on">List<\/button>/);
});

test("no value selects no tab, for a collapsed sidebar", () => {
  const out = html(<ViewSwitch label="Sidebar view" value={null} onChange={() => {}} options={[{ value: "outline", label: "Outline" }]} />);
  assert.doesNotMatch(out, /aria-selected="true"|seg-on/);
});

test("extra classes join the strip; a tab may carry a hover title and an icon", () => {
  const out = html(
    <ViewSwitch
      label="Sidebar view"
      value="outline"
      onChange={() => {}}
      className="pdf-reader-side-seg"
      options={[{ value: "outline", label: "Outline", title: "Table of contents", icon: <svg /> }]}
    />,
  );
  assert.match(out, /class="seg view-switch pdf-reader-side-seg"/);
  assert.match(out, /title="Table of contents"/);
  assert.match(out, /<svg><\/svg>Outline/);
});
