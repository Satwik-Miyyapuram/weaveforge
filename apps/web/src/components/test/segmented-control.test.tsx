/** One SegmentedControl: pressed state, not primary colour (design D02, DA-15). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SegmentedControl } from "../segmented-control";

const options = [
  { value: "cites", label: "Cites" },
  { value: "tags", label: "Tags" },
] as const;

test("the chosen option is pressed; the others are not", () => {
  const out = renderToStaticMarkup(<SegmentedControl label="Edges" value="tags" onChange={() => {}} options={options} />);
  assert.match(out, /^<div class="wf-seg" role="group" aria-label="Edges">/);
  assert.match(out, /<button type="button" aria-pressed="false">Cites<\/button>/);
  assert.match(out, /<button type="button" aria-pressed="true">Tags<\/button>/);
});

test("no option is styled as a primary button", () => {
  const out = renderToStaticMarkup(<SegmentedControl label="Edges" value="cites" onChange={() => {}} options={options} />);
  assert.doesNotMatch(out, /wf-primary/);
});

test("an extra layout class joins the group class", () => {
  const out = renderToStaticMarkup(<SegmentedControl label="Edges" value="cites" onChange={() => {}} options={options} className="x" />);
  assert.match(out, /class="wf-seg x"/);
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
  assert.match(out, /<button type="button" aria-pressed="true" aria-label="Tree view" title="Tree view"><svg><\/svg><\/button>/);
});

test("no value presses no option, for an image with no side set yet", () => {
  const out = renderToStaticMarkup(<SegmentedControl label="Edges" value={null} onChange={() => {}} options={options} />);
  assert.doesNotMatch(out, /aria-pressed="true"/);
});
