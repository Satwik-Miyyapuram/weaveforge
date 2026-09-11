import { test } from "node:test";
import assert from "node:assert/strict";

import { breadcrumbs } from "../application/breadcrumbs";
import { headingSlug, outlineOf } from "../application/outline";
import { minimapLines, viewportFraction } from "../ui/minimap";
import {
  buildListsTree,
  buildWorkspaceTree,
  type WorkspaceTreeNode,
} from "../application/workspace-tree";

function files(): WorkspaceTreeNode[] {
  return buildWorkspaceTree({
    notes: [
      { id: "c", title: "Baselines", parentId: "b" },
      { id: "b", title: "Chapter two", parentId: "a" },
      { id: "a", title: "Thesis" },
    ],
    papers: [{ id: "p1", title: "Attention", hasNote: true }],
    reportSections: [{ id: "s1", title: "Results" }],
  });
}

test("crumbs for a deep note are its whole folder chain", () => {
  const crumbs = breadcrumbs({ kind: "vault_page", id: "c" }, files());
  assert.deepEqual(
    crumbs.map((crumb) => crumb.label),
    ["Files", "Notes", "Thesis", "Chapter two", "Baselines"],
  );
  assert.equal(crumbs[crumbs.length - 1]!.current, true);
});

test("crumbs for a paper are the root and the paper", () => {
  const crumbs = breadcrumbs({ kind: "paper", id: "p1" }, files());
  assert.deepEqual(
    crumbs.map((crumb) => crumb.label),
    ["Files", "Papers", "Attention"],
  );
});

test("a document under a reading list follows the list, not the folder", () => {
  const lists = buildListsTree({
    lists: [
      { id: "l1", title: "Latent spaces" },
      { id: "l2", title: "Disentanglement", parentId: "l1" },
    ],
    items: [{ listId: "l2", kind: "paper", id: "p1" }],
    titles: new Map([["paper:p1", "Attention"]]),
  });

  const crumbs = breadcrumbs({ kind: "paper", id: "p1" }, files(), lists);
  assert.deepEqual(
    crumbs.map((crumb) => crumb.label),
    ["Reading lists", "Latent spaces", "Disentanglement", "Attention"],
  );
});

test("a document in no tree at all still gets a crumb rather than an empty strip", () => {
  const crumbs = breadcrumbs({ kind: "paper", id: "gone" }, files());
  assert.equal(crumbs.length, 1);
  assert.equal(crumbs[0]!.current, true);
});

test("the outline lists the headings of the document in order", () => {
  const headings = outlineOf("# One\n\ntext\n\n## Two\n\n### Three\n\n#### Too deep");
  assert.deepEqual(
    headings.map((heading) => [heading.level, heading.text]),
    [
      [1, "One"],
      [2, "Two"],
      [3, "Three"],
    ],
  );
});

test("a heading inside a fenced block is not a heading", () => {
  const headings = outlineOf("# Real\n\n```sh\n# not a heading\n```\n\n## Also real");
  assert.deepEqual(
    headings.map((heading) => heading.text),
    ["Real", "Also real"],
  );
});

test("the outline slug is the id the read view writes", () => {
  // Pinned against `markdown.tsx`'s own `headingSlug`: a run of
  // non-alphanumerics collapses to one hyphen, and both ends are trimmed.
  // Note `β` is a letter and survives; `&` does not.
  assert.equal(headingSlug("Baselines & β-VAE"), "baselines-β-vae");
  assert.equal(headingSlug("  Trailing —"), "trailing");
  assert.equal(outlineOf("## Baselines & β-VAE")[0]!.slug, headingSlug("Baselines & β-VAE"));
});

test("a document with no headings has an empty outline, and that is not an error", () => {
  assert.deepEqual(outlineOf("just prose\nand more"), []);
  assert.deepEqual(outlineOf(""), []);
});

test("every line becomes a bar, blank lines included", () => {
  const bars = minimapLines("one\n\ntwo");
  assert.equal(bars.length, 3);
  assert.equal(bars[1]!.blank, true);
  assert.equal(bars[1]!.width, 0);
});

test("a heading bar is marked at its level and indentation is read off the line", () => {
  const bars = minimapLines("## Heading\n    indented text");
  assert.equal(bars[0]!.heading, 2);
  assert.ok(bars[1]!.indent > 0);
});

test("a very long document is sampled to the column, not cut off", () => {
  const body = Array.from({ length: 1000 }, (_, index) => `line ${index}`).join("\n");
  assert.equal(minimapLines(body).length, 220);
});

test("the viewport is a fraction of the document, and unknown without a cursor", () => {
  assert.equal(viewportFraction({ cursor: { line: 50, col: 1 } }, 100), 0.5);
  assert.equal(viewportFraction({}, 100), null);
  assert.equal(viewportFraction(undefined, 100), null);
  assert.equal(viewportFraction({ cursor: { line: 1, col: 1 } }, 0), null);
});
