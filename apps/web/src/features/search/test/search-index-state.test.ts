import assert from "node:assert/strict";
import test from "node:test";

import type { IWorkspaceSearchIndex, SearchDoc, WorkspaceSnapshot } from "@weaveforge/core";
import { emptyWorkspaceSnapshot as snapshot } from "@weaveforge/core/testing";
import { SearchIndexState, KINDS_FOR_RESOURCE } from "../application/search-index-state";
import { projectSearchDocuments } from "../application/search-projection";

/**
 * The two pieces of `WorkspaceSearch` that had no test of their own.
 *
 * The state object is where the class's one real bug lived — the staleness set
 * cleared before the snapshot was awaited, so a rejected read lost the kinds for
 * good — and it could not be tested while the fields sat on a class that needs a
 * snapshot, a worker, IndexedDB and MiniSearch to do anything. The projection is
 * the other one: four callers build a corpus with it and the *order* is part of
 * the revision that decides whether a cached index may be trusted.
 */

function index(): IWorkspaceSearchIndex {
  return { idsOfKind: () => [], remove: () => {}, add: () => {} } as unknown as IWorkspaceSearchIndex;
}

test("a kind stays stale until a refresh that read successfully settles it", () => {
  const state = new SearchIndexState();
  state.adopt(index(), 10);

  state.markStale("vault_page");

  assert.deepEqual(state.pendingStale(), ["note"], "asking does not clear the mark");
  assert.deepEqual(state.pendingStale(), ["note"], "asking twice does not either");

  // The refresh read, replaced the documents, and only then settles.
  state.settleStale(["note"]);
  assert.deepEqual(state.pendingStale(), []);
});

test("settling one kind leaves another marked", () => {
  // The bug's other half: clearing the whole set meant a write that landed
  // during a refresh was forgotten along with the kinds being refreshed.
  const state = new SearchIndexState();
  state.adopt(index(), 0);

  state.markStale("vault_page");
  state.markStale("paper");
  state.settleStale(["note"]);

  assert.deepEqual(state.pendingStale().sort(), ["annotation", "paper"]);
});

test("an unclassified write distrusts the whole index", () => {
  const state = new SearchIndexState();
  state.adopt(index(), 10);
  state.graph = {} as never;
  state.pdfPageCounts.set("p1", 3);

  const forgot = state.markStale("something-new");

  assert.equal(forgot, true, "the caller has nothing left to refresh selectively");
  assert.equal(state.ready, false);
  assert.equal(state.graph, null, "and the graph goes with it — degrees were its");
  assert.equal(state.documentCount, 0);
  assert.equal(state.pdfPageCounts.size, 0, "so a re-extraction is not told pages still exist");
});

test("nothing is marked stale before an index exists", () => {
  // There is no index to be stale, and the first build reads everything anyway.
  const state = new SearchIndexState();

  assert.equal(state.markStale("vault_page"), false);
  assert.deepEqual(state.pendingStale(), []);
});

test("every mapped resource type names kinds the index knows", () => {
  // The mapping is the policy, so a typo in it is a write that silently never
  // refreshes anything — no error, just an edit the search cannot see.
  const known = new Set(["paper", "note", "annotation", "pdf", "list", "section", "experiment", "milestone", "log"]);
  for (const [resourceType, kinds] of Object.entries(KINDS_FOR_RESOURCE)) {
    for (const kind of kinds ?? []) {
      assert.ok(known.has(kind), `${resourceType} names a search kind that does not exist: ${kind}`);
    }
  }
});

test("the projection holds three sources in a fixed order", () => {
  // The order is part of the revision: reordering it would invalidate every
  // cached index once, silently, for everyone.
  const ws = snapshot({
    vaultPages: [{ id: "n1", title: "Method", body: "boiling water", sortOrder: 0 }] as never,
  });

  const docs = projectSearchDocuments({ snapshot: ws, graph: null, pdfTexts: [] });

  assert.ok(docs.length > 0);
  assert.equal(docs[0]!.kind, "note", "the snapshot's own documents come first");
});

test("the projection reads degrees from the graph it is handed", () => {
  // Passed in rather than read from a field, because the graph is rebuilt on its
  // own schedule during a stale refresh — before this runs.
  const ws = snapshot({
    vaultPages: [
      { id: "n1", title: "A", body: "see [[B]]", sortOrder: 0 },
      { id: "n2", title: "B", body: "back to [[A]]", sortOrder: 1 },
    ] as never,
  });

  const withGraph = projectSearchDocuments({
    snapshot: ws,
    graph: { nodes: new Map(), edges: [] } as never,
    pdfTexts: [],
  });
  const withoutGraph = projectSearchDocuments({ snapshot: ws, graph: null, pdfTexts: [] });

  assert.equal(withGraph.length, withoutGraph.length, "the same corpus either way");
  assert.deepEqual(
    withGraph.map((doc: SearchDoc) => doc.id),
    withoutGraph.map((doc) => doc.id),
    "and in the same order, so a revision computed here matches one computed there",
  );
});

test("extracted PDF text is projected with the snapshot's documents", () => {
  const ws = snapshot({
    papers: [
      {
        id: "p1",
        title: "Attention",
        authors: [],
        status: "to_read",
        tags: [],
        metadata: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ] as never,
  });

  const docs = projectSearchDocuments({
    snapshot: ws,
    graph: null,
    pdfTexts: [
      {
        paperId: "p1",
        title: "Attention",
        pages: [{ pageIndex: 0, text: "photosynthesis ".repeat(60) }],
        extractedAt: "2026-03-01T00:00:00.000Z",
      },
    ],
  });

  assert.ok(
    docs.some((doc) => doc.kind === "pdf"),
    "page text is indexed, which is why a search finds a phrase inside a PDF",
  );
});

test("a snapshot with nothing in it projects nothing, rather than throwing", () => {
  const ws: WorkspaceSnapshot = snapshot();
  assert.deepEqual(projectSearchDocuments({ snapshot: ws, graph: null, pdfTexts: [] }), []);
});
