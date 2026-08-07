import assert from "node:assert/strict";
import test from "node:test";
import {
  annotationDocId,
  toAnnotationSearchDocs,
  type WorkspaceAnnotation,
} from "../src/index.js";

const titles = new Map([["p1", "Attention Is All You Need"]]);

function annotation(over: Partial<WorkspaceAnnotation> = {}): WorkspaceAnnotation {
  return {
    id: "a1",
    paperId: "p1",
    pageIndex: 3,
    origin: "local",
    zoteroKey: null,
    type: "highlight",
    color: "#ffd400",
    text: "Attention allows modeling of dependencies without regard to distance.",
    comment: "This is the claim the whole paper rests on.",
    tags: ["key-claim"],
    anchor: {},
    sortIndex: "00003|0000|0000",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
    ...over,
  };
}

test("both the quoted passage and the comment are searchable", () => {
  const [doc] = toAnnotationSearchDocs([annotation()], titles);
  assert.ok(doc);
  assert.match(doc.body, /dependencies without regard to distance/);
  assert.match(doc.body, /the claim the whole paper rests on/);
});

test("a hit opens the reader at the page the highlight is on", () => {
  const [doc] = toAnnotationSearchDocs([annotation()], titles);
  assert.equal(doc!.href, "/reader?paper=p1&page=3");
  assert.equal(doc!.page, 3);
  assert.equal(doc!.path, "page 4", "the path reads as a human page number");
});

test("the paper's title is how a highlight is recognised", () => {
  const [doc] = toAnnotationSearchDocs([annotation()], titles);
  assert.equal(doc!.title, "Attention Is All You Need");
  assert.equal(doc!.entityId, "p1", "grouped under the paper, like a PDF page");
});

test("a short comment ranks like a title rather than competing with the quote", () => {
  const [doc] = toAnnotationSearchDocs([annotation({ comment: "key result" })], titles);
  assert.deepEqual(doc!.aliases, ["key result"]);
});

test("an ink stroke or crop with no text is not indexed", () => {
  const docs = toAnnotationSearchDocs(
    [annotation({ id: "a2", type: "ink", text: "", comment: "" })],
    titles,
  );
  assert.deepEqual(docs, [], "an empty document would surface on title-only matches");
});

test("a highlight with no comment still indexes its passage", () => {
  const [doc] = toAnnotationSearchDocs([annotation({ comment: "" })], titles);
  assert.ok(doc);
  assert.deepEqual(doc.aliases, []);
  assert.match(doc.body, /dependencies/);
});

test("a comment with no highlighted text still indexes", () => {
  const [doc] = toAnnotationSearchDocs(
    [annotation({ type: "note", text: "", comment: "Check this against the VAE paper." })],
    titles,
  );
  assert.match(doc!.body, /Check this against the VAE paper/);
});

test("a paper missing from the title map does not lose its annotation", () => {
  const [doc] = toAnnotationSearchDocs([annotation({ paperId: "gone" })], titles);
  assert.equal(doc!.title, "Annotation");
  assert.match(doc!.body, /dependencies/);
});

test("tags on a highlight are searchable", () => {
  const [doc] = toAnnotationSearchDocs([annotation()], titles);
  assert.deepEqual(doc!.tags, ["key-claim"]);
});

test("ids are stable and namespaced", () => {
  const [doc] = toAnnotationSearchDocs([annotation()], titles);
  assert.equal(doc!.id, annotationDocId("a1"));
  assert.equal(doc!.id, "annotation:a1");
});

test("the paper's link degree carries to its highlights", () => {
  const [doc] = toAnnotationSearchDocs([annotation()], titles, new Map([["paper:p1", 7]]));
  assert.equal(doc!.degree, 7);
});
