/// <reference lib="webworker" />

import {
  buildWikiGraph,
  graphDegrees,
  searchRevision,
  toAnnotationSearchDocs,
  toPdfSearchDocs,
  toSearchDocs,
  type SearchDoc,
  type SearchSettings,
  type WorkspaceSnapshot,
} from "@weaveforge/core";
import { buildSearchIndex } from "./minisearch-index";
import { loadPdfTexts } from "./pdf-text-store";

/**
 * Building the search index, off the main thread.
 *
 * Measured on a 15 000-document corpus, tokenizing takes about ten seconds and
 * rehydrating the same index from JSON takes half of one. That ratio is the
 * whole design: the expensive half happens here, and the main thread does the
 * cheap half.
 *
 * The worker reads extracted PDF text from IndexedDB itself rather than being
 * handed it. That text is the bulk of a large corpus, and structured-cloning it
 * across the boundary would hand back a good part of what the worker saves.
 */

export interface BuildIndexRequest {
  id: number;
  snapshot: WorkspaceSnapshot;
  projectId: string | null;
  settings?: SearchSettings;
}

export type BuildIndexResponse =
  | {
      id: number;
      type: "built";
      /** Serialized index; the caller rehydrates rather than rebuilds. */
      serialized: string;
      revision: string;
      documentCount: number;
      /** Enough for the caller to keep its own bookkeeping in step. */
      pdfPageCounts: [string, number][];
      annotationCount: number;
    }
  | { id: number; type: "error"; message: string };

const post = (message: BuildIndexResponse) => (self as unknown as Worker).postMessage(message);

async function project(
  snapshot: WorkspaceSnapshot,
  projectId: string | null,
): Promise<{ docs: SearchDoc[]; pdfPageCounts: [string, number][] }> {
  const stored = await loadPdfTexts(projectId);
  // Papers the library no longer holds keep their extracted text in storage;
  // indexing it would answer searches with hits that open a missing paper.
  const paperIds = new Set(snapshot.papers.map((paper) => paper.id));
  const pdfTexts = stored.filter((source) => paperIds.has(source.paperId));

  const graph = buildWikiGraph(snapshot);
  const degrees = graphDegrees(graph);
  const paperTitles = new Map(snapshot.papers.map((paper) => [paper.id, paper.title]));

  return {
    docs: [
      ...toSearchDocs(snapshot, degrees),
      ...toPdfSearchDocs(pdfTexts, degrees),
      ...toAnnotationSearchDocs(snapshot.readerAnnotations, paperTitles, degrees),
    ],
    pdfPageCounts: pdfTexts.map((source) => [source.paperId, source.pages.length]),
  };
}

self.addEventListener("message", (event: MessageEvent<BuildIndexRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      const { docs, pdfPageCounts } = await project(request.snapshot, request.projectId);
      const revision = searchRevision(docs);
      const index = buildSearchIndex(docs, revision, request.settings);

      post({
        id: request.id,
        type: "built",
        // Serializing is itself a second-scale stall on a large corpus, so it
        // happens here too rather than on the thread that has to stay responsive.
        serialized: index.serialize(),
        revision,
        documentCount: docs.length,
        pdfPageCounts,
        annotationCount: request.snapshot.readerAnnotations.length,
      });
    } catch (error) {
      post({
        id: request.id,
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});
