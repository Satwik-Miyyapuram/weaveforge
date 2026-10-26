/** One SegmentedControl: pressed state, not primary colour (design D02, DA-15). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SegmentedControl } from "../segmented-control";

const options = [
  { value: "cites", label: "Cites" },
  { value: "tags", label: "Tags" },
] as const;

test("the chosen option is pressed and marked seg-on; the others are not", () => {
  const out = renderToStaticMarkup(<SegmentedControl label="Edges" value="tags" onChange={() => {}} options={options} />);
  assert.match(out, /^<div class="seg" role="group" aria-label="Edges">/);
  assert.match(out, /<button type="button" aria-pressed="false">Cites<\/button>/);
  assert.match(out, /<button type="button" aria-pressed="true" class="seg-on">Tags<\/button>/);
});

test("no option is styled as a primary button", () => {
  const out = renderToStaticMarkup(<SegmentedControl label="Edges" value="cites" onChange={() => {}} options={options} />);
  assert.doesNotMatch(out, /btn-primary/);
});

test("sm and extra classes join the group class", () => {
  const out = renderToStaticMarkup(
    <SegmentedControl label="Edges" value="cites" onChange={() => {}} options={options} size="sm" className="x" />,
  );
  assert.match(out, /class="seg seg--sm x"/);
});

test("an icon-only option is named by its ariaLabel", () => {
  const out = renderToStaticMarkup(
    <SegmentedControl
      label="List view"
      value="tree"
      onChange={() => {}}
      options={[{ value: "tree", label: <svg />, ariaLabel: "Tree view", title: "Tree view" }]}
    />,
  );
  assert.match(out, /<button type="button" aria-pressed="true" aria-label="Tree view" class="seg-on" title="Tree view"><svg><\/svg><\/button>/);
});
