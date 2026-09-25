import {
  graphDegrees,
  toAnnotationSearchDocs,
  toPdfSearchDocs,
  toSearchDocs,
  type PdfIndexSource,
  type SearchDoc,
  type WikiGraph,
  type WorkspaceSnapshot,
} from "@weaveforge/core";

/**
 * A snapshot, projected into the documents the index holds.
 *
 * Pulled out of `WorkspaceSearch`, which was the only place this could be read
 * from and also the only place a mistake in it could hide: four different things
 * ask for the projection — a cache check, the worker build, the in-thread build,
 * and the semantic arm — and all four must produce the same corpus down to the
 * order of the documents, because the revision that decides whether a cached
 * index may be trusted is computed from it.
 *
 * Three sources, in this order: the snapshot's own documents (notes, papers,
 * experiments, …), the extracted PDF page text, and the reader's annotations.
 * The order is part of the revision, so it is fixed here rather than left to a
 * caller to assemble.
 *
 * `graph` is a parameter rather than something read from the caller's state
 * because degrees are a ranking input and the graph is rebuilt on its own
 * schedule — during a stale refresh, before this runs.
 */
export function projectSearchDocuments(input: {
  snapshot: WorkspaceSnapshot;
  graph: WikiGraph | null;
  pdfTexts: readonly PdfIndexSource[];
}): SearchDoc[] {
  const degrees = input.graph ? graphDegrees(input.graph) : new Map<string, number>();
  const paperTitles = new Map(input.snapshot.papers.map((paper) => [paper.id, paper.title]));
  return [
    ...toSearchDocs(input.snapshot, degrees),
    ...toPdfSearchDocs(input.pdfTexts, degrees),
    ...toAnnotationSearchDocs(input.snapshot.readerAnnotations, paperTitles, degrees),
  ];
}
