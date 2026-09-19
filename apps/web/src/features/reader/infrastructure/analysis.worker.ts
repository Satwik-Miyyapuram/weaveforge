/// <reference lib="webworker" />

/**
 * The document analysis, built off the main thread.
 *
 * A long paper's text layer is a few hundred thousand characters and the
 * analysis walks it several times; on a tablet that is a visible stall if it
 * runs where the pages paint. The worker owns nothing: it takes the same
 * pages the in-thread path would and calls the same core `analyzePdfDocument`,
 * so the two can never disagree about what is on a page. The result is the
 * `DocumentAnalysis` itself — plain arrays and scalars only, no Maps — so it
 * crosses `postMessage` as-is.
 */

import { analyzePdfDocument, type DocumentAnalysis, type PdfLink, type ReaderOutlineItem } from "@weaveforge/core";
import type { ReferencePage } from "../application/reader-references";

export interface AnalysisWorkerPage extends ReferencePage {
  links: PdfLink[];
}

export interface AnalysisRequest {
  id: number;
  pages: AnalysisWorkerPage[];
  outline: ReaderOutlineItem[];
}

export type AnalysisResponse =
  | { id: number; type: "progress"; percent: number }
  | { id: number; type: "complete"; analysis: DocumentAnalysis }
  | { id: number; type: "error"; message: string };

const post = (message: AnalysisResponse) => (self as unknown as Worker).postMessage(message);

self.addEventListener("message", (event: MessageEvent<AnalysisRequest>) => {
  const data = event.data;
  if (!data || typeof data.id !== "number" || !Array.isArray(data.pages)) return;
  const { id, pages, outline } = data;
  try {
    post({ id, type: "progress", percent: 20 });
    const analysis = analyzePdfDocument(
      pages.map((page) => ({ pageNumber: page.pageNumber, items: page.items, links: page.links ?? [] })),
      outline,
    );
    post({ id, type: "complete", analysis });
  } catch (err) {
    post({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
});
