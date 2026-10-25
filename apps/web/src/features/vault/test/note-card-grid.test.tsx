import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { VaultPageSummary } from "@weaveforge/core";

import { NoteCardGrid } from "../ui/vault-screen/note-card-grid";

const n = (id: string) => ({ id, title: id, bodyPreview: "", sortOrder: 0 }) as unknown as VaultPageSummary;

function headings(mine: number, unpinned: number, shared: number): string[] {
  const html = renderToStaticMarkup(
    createElement(NoteCardGrid, {
      mine: Array.from({ length: mine }, (_, i) => n(`m${i}`)),
      unpinned: Array.from({ length: unpinned }, (_, i) => n(`u${i}`)),
      shared: Array.from({ length: shared }, (_, i) => n(`s${i}`)),
      isPinned: () => true,
      sharedOwnerName: () => undefined,
      onOpen: () => {},
      onChanged: () => {},
    }),
  );
  return [...html.matchAll(/<h4[^>]*>([^<]*)<\/h4>/g)].map((m) => m[1]!);
}

test("sections show only when they have notes (34-25)", () => {
  assert.deepEqual(headings(1, 1, 1), ["Pinned", "All notes", "Shared with you"]);
  assert.deepEqual(headings(0, 3, 0), []);
  assert.deepEqual(headings(0, 0, 2), ["Shared with you"]);
});

test("'All notes' is labelled only under a Pinned section (34-25)", () => {
  assert.deepEqual(headings(2, 0, 0), ["Pinned"]);
  assert.deepEqual(headings(0, 2, 1), ["Shared with you"]);
});

test("nothing to show renders nothing (34-25)", () => {
  assert.deepEqual(headings(0, 0, 0), []);
});
