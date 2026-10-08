import { test } from "node:test";
import assert from "node:assert/strict";
import type { DocumentSearchMatch, PageTextItem } from "@weaveforge/core";
import { measureFindDomBoxes } from "../ui/find-overlay.js";

test("measureFindDomBoxes returns null when document is undefined or DOM layout is unavailable", () => {
  // In pure Node.js without browser DOM Range layout, it returns null cleanly so geometric fallback is used
  const items: PageTextItem[] = [
    { str: "Inductive ", transform: [1, 0, 0, 1, 72, 700], width: 50, height: 12 },
    { str: "Graphs", transform: [1, 0, 0, 1, 122, 700], width: 45, height: 12 },
  ];
  const matches: DocumentSearchMatch[] = [
    { pageIndex: 0, start: 10, end: 15 },
  ];

  const dummyEl = {} as HTMLElement;
  const result = measureFindDomBoxes(dummyEl, dummyEl, items, matches, 0, 0);
  assert.equal(result, null);
});
