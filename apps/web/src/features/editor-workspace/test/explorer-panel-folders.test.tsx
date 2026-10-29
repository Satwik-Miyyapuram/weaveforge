/**
 * Only a folder holds children. A folder row wears the folder icon and offers
 * "New note here" and "New folder here"; a plain note row offers neither, but
 * keeps its Rename button.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ExplorerPanel } from "../ui/explorer-panel";
import { buildWorkspaceTree } from "../application/workspace-tree";

function rows(): Map<string, string> {
  const tree = buildWorkspaceTree({
    projectRoot: "",
    notes: [
      { id: "f1", title: "Methods", parentId: undefined, folder: true },
      { id: "n1", title: "Sampling", parentId: undefined },
    ],
    papers: [],
    reportSections: [],
  });
  const html = renderToStaticMarkup(
    createElement(ExplorerPanel, {
      sections: [{ id: "files", title: "Files", tree }],
      onOpen: () => {},
      onDraft: () => {},
      onRename: async () => {},
    }),
  );
  const out = new Map<string, string>();
  for (const row of html.split(/(?=<[a-z]+[^>]*role="treeitem")/).slice(1)) {
    const label = row.match(/class="explorer-label" title="([^"]*)"/)?.[1];
    if (label) out.set(label, row);
  }
  return out;
}

test("a folder row offers a new note and a new folder", () => {
  const folder = rows().get("Methods");
  assert.ok(folder, "the folder row is painted");
  assert.match(folder, /New note here/);
  assert.match(folder, /New folder here/);
});

test("a plain note row offers nothing to create under it but can still be renamed", () => {
  const note = rows().get("Sampling");
  assert.ok(note, "the note row is painted");
  assert.doesNotMatch(note, /New note here|New folder here/);
  assert.match(note, /Rename/);
});

test("the folder wears the Notes root's folder icon; the note its own", () => {
  const all = rows();
  const icon = (label: string) => {
    const row = all.get(label);
    assert.ok(row, `${label} is painted`);
    return row.match(/class="explorer-icon[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "";
  };
  assert.equal(icon("Methods"), icon("Notes"));
  assert.notEqual(icon("Methods"), icon("Sampling"));
});
