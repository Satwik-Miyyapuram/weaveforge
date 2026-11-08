import assert from "node:assert/strict";
import test from "node:test";
import type { ReaderAnnotation, WorkspaceAnnotation } from "@weaveforge/core";
import { draftReadingLog, highlightsDigest } from "../application/reading-digest";

function mark(over: Partial<ReaderAnnotation> & { page?: number }): ReaderAnnotation {
  const { page, ...rest } = over;
  return {
    id: "a",
    origin: "local",
    zoteroKey: null,
    type: "highlight",
    color: "#ffd400",
    text: "",
    comment: "",
    tags: [],
    anchor: page === undefined ? {} : { zoteroPosition: { pageIndex: page } },
    sortIndex: "0",
    createdAt: "2026-11-08T09:00:00",
    updatedAt: "2026-11-08T09:00:00",
    ...rest,
  };
}

test("highlights become quotes with a page link and the comment, in page order", () => {
  const out = highlightsDigest(
    [
      mark({ id: "2", text: "second point", comment: "why it matters", page: 4, sortIndex: "1" }),
      mark({ id: "1", text: "first point", page: 0, sortIndex: "0" }),
    ],
    { paperId: "p1", existing: "" },
  );
  assert.equal(
    out,
    "## Highlights\n\n" +
      "> first point\n\n[p. 1](/reader?paper=p1&page=0)\n\n" +
      "> second point\n\n[p. 5](/reader?paper=p1&page=4) why it matters\n",
  );
});

test("the quote is repaired the way a copied cite is", () => {
  const out = highlightsDigest([mark({ text: "long-term expo-\nsure", page: 0 })], { paperId: "p", existing: "" });
  assert.match(out, /> long-term exposure\n/);
});

test("an ink mark with only a comment keeps the comment", () => {
  const out = highlightsDigest([mark({ type: "ink", comment: "see figure", page: 2 })], { paperId: "p", existing: "" });
  assert.match(out, /\[p\. 3\]\(\/reader\?paper=p&page=2\) see figure\n$/);
  assert.doesNotMatch(out, /^>/m);
});

test("marks with no text and no comment are skipped", () => {
  assert.equal(highlightsDigest([mark({ type: "ink", page: 1 })], { paperId: "p", existing: "" }), "");
});

test("running it twice adds nothing new, and no second heading", () => {
  const anns = [mark({ id: "1", text: "first point", page: 0 })];
  const once = highlightsDigest(anns, { paperId: "p", existing: "" });
  assert.equal(highlightsDigest(anns, { paperId: "p", existing: `My note\n\n${once}` }), "");
  const more = highlightsDigest([...anns, mark({ id: "2", text: "new one", page: 1 })], {
    paperId: "p",
    existing: `My note\n\n${once}`,
  });
  assert.equal(more, "> new one\n\n[p. 2](/reader?paper=p&page=1)\n");
});

test("a mark with no page links to the paper in the reader", () => {
  const out = highlightsDigest([mark({ text: "somewhere" })], { paperId: "p", existing: "" });
  assert.match(out, /\[in reader\]\(\/reader\?paper=p\)\n$/);
});

function wsMark(paperId: string, createdAt: string): WorkspaceAnnotation {
  return { ...mark({ createdAt }), paperId, pageIndex: 0 };
}

test("the log draft lists today's papers by how much was marked, with read ones too", () => {
  const day = new Date(2026, 10, 8, 18, 0);
  const papers = [
    { id: "a", title: "Alpha" },
    { id: "b", title: "Beta" },
    { id: "c", title: "Gamma", readAt: new Date(2026, 10, 8, 10, 0).toISOString() },
    { id: "d", title: "Old", readAt: new Date(2026, 10, 1, 10, 0).toISOString() },
  ];
  const today = new Date(2026, 10, 8, 9, 0).toISOString();
  const anns = [
    wsMark("a", today),
    wsMark("b", today),
    wsMark("b", today),
    wsMark("a", new Date(2026, 10, 7, 9, 0).toISOString()),
  ];
  assert.equal(
    draftReadingLog(papers, anns, day),
    "Reading:\n- [[Beta]]: 2 annotations\n- [[Alpha]]: 1 annotation\n- [[Gamma]]\n",
  );
});

test("no reading today drafts nothing", () => {
  assert.equal(draftReadingLog([{ id: "a", title: "A" }], [], new Date(2026, 10, 8)), "");
});
