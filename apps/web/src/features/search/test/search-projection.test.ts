/**
 * The worker projects through the same function as the main thread (27-05).
 *
 * The worker kept its own copy of the three-source projection. The revision
 * that decides whether a cached index may be trusted is computed from that
 * corpus, so a copy that drifts makes every cached index look stale, or worse,
 * fresh when it is not.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { emptyWorkspaceSnapshot as snapshot } from "@weaveforge/core/testing";
import { buildWikiGraph, searchRevision, type PdfIndexSource, type WorkspaceSnapshot } from "@weaveforge/core";

import { projectSearchDocuments, projectStoredPdfTexts } from "../application/search-projection";

const paper = (id: string, title: string) =>
  ({
    id,
    title,
    authors: [],
    status: "to_read",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  }) as unknown as WorkspaceSnapshot["papers"][number];

const pdf = (paperId: string, ...pages: string[]): PdfIndexSource => ({
  paperId,
  title: paperId,
  pages: pages.map((text, pageIndex) => ({ pageIndex, text })),
  extractedAt: "2026-03-01T00:00:00.000Z",
});

const body = "attention is all you need, and then some more words so the page is long enough to index";

test("the worker's projection is the main thread's projection", () => {
  const snap = snapshot({ papers: [paper("pa1", "Attention"), paper("pa2", "Transformers")] });
  const stored = [pdf("pa1", body, body), pdf("pa2", body)];
  const { docs } = projectStoredPdfTexts(snap, stored);
  const expected = projectSearchDocuments({ snapshot: snap, graph: buildWikiGraph(snap), pdfTexts: stored });
  assert.deepEqual(docs, expected);
  assert.equal(searchRevision(docs), searchRevision(expected));
});

test("text of a paper the library no longer holds is dropped", () => {
  const snap = snapshot({ papers: [paper("pa1", "Attention")] });
  const { docs, pdfPageCounts } = projectStoredPdfTexts(snap, [pdf("pa1", body), pdf("gone", body, body)]);
  assert.deepEqual(pdfPageCounts, [["pa1", 1]]);
  assert.ok(docs.every((d) => !d.id.includes("gone")));
});

test("no stored text projects the snapshot alone", () => {
  const snap = snapshot({ papers: [paper("pa1", "Attention")] });
  const { docs, pdfPageCounts } = projectStoredPdfTexts(snap, []);
  assert.deepEqual(pdfPageCounts, []);
  assert.deepEqual(docs, projectSearchDocuments({ snapshot: snap, graph: buildWikiGraph(snap), pdfTexts: [] }));
});
