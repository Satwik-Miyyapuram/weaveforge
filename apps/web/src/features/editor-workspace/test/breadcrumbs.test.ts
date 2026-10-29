import { test } from "node:test";
import assert from "node:assert/strict";

import { breadcrumbs } from "../application/breadcrumbs";
import { headingSlug, outlineOf } from "../application/outline";
import {
  buildListsTree,
  buildWorkspaceTree,
  type WorkspaceTreeNode,
} from "../application/workspace-tree";

function files(): WorkspaceTreeNode[] {
  return buildWorkspaceTree({
    projectRoot: "",
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

test("crumbs for a paper's notes are the root, the paper and the file", () => {
  const crumbs = breadcrumbs({ kind: "paper", id: "p1" }, files());
  assert.deepEqual(
    crumbs.map((crumb) => crumb.label),
    ["Files", "Papers", "Attention", "Notes"],
  );
  assert.deepEqual(
    breadcrumbs({ kind: "paper_pdf", id: "p1" }, files()).map((crumb) => crumb.label),
    ["Files", "Papers", "Attention", "PDF"],
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

test("a heading ending in # keeps it unless the # is a closing sequence", () => {
  // `.+?` used to give the trailing `#` of "C#" to the closing sequence, so the
  // outline said "Learning C" while the read view said "Learning C#".
  const headings = outlineOf("## Learning C#\n\n## Closed ##\n\n# Issue #12\n\n### #");
  assert.deepEqual(
    headings.map((heading) => heading.text),
    ["Learning C#", "Closed", "Issue #12"],
  );
});

test("a fence closes only on the same marker, at least as long", () => {
  // A ```` fence that shows a ``` fence, or a ~~~ line inside a ``` block,
  // used to toggle the fence and list the code's `# comment` as a heading.
  const body = "````md\n```\n# not a heading\n```\n````\n\n```sh\n~~~\n# nor this\n```\n\n## Real";
  assert.deepEqual(
    outlineOf(body).map((heading) => heading.text),
    ["Real"],
  );
});

test("a '#' that ends a heading word is kept; only a spaced closing run is dropped", () => {
  assert.deepEqual(
    outlineOf("# Learning C#\n## F# notes ##\n## Intro ##\n### #hashtag topic").map((h) => h.text),
    ["Learning C#", "F# notes", "Intro", "#hashtag topic"],
  );
});
