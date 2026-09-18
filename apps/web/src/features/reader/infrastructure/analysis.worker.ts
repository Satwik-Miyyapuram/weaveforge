/// <reference lib="webworker" />

/**
 * The reference index, built off the main thread.
 *
 * A long paper's text layer is a few hundred thousand characters and the
 * parsers walk it several times; on a tablet that is a visible stall if it
 * runs where the pages paint. The worker owns nothing: it takes the same
 * pages the in-thread path would and calls the same `buildReferenceIndex`,
 * so the two can never disagree about what is on a page. Maps do not cross
 * `postMessage` as Maps, so the result goes over as entries.
 */

import type { ParsedReference, PdfLink, ReaderOutlineItem } from "@weaveforge/core";
import { buildReferenceIndex, type MentionHit, type ReferencePage } from "../application/reader-references";

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
  | {
      id: number;
      type: "complete";
      references: ParsedReference[];
      mentionsByPage: [number, MentionHit[]][];
      bodyFontSize: number;
      fingerprint: string;
    }
  | { id: number; type: "error"; message: string };

const post = (message: AnalysisResponse) => (self as unknown as Worker).postMessage(message);

self.addEventListener("message", (event: MessageEvent<AnalysisRequest>) => {
  const data = event.data;
  if (!data || typeof data.id !== "number" || !Array.isArray(data.pages)) return;
  const { id, pages, outline } = data;
  try {
    post({ id, type: "progress", percent: 20 });
    const index = buildReferenceIndex(pages, outline);
    post({
      id,
      type: "complete",
      references: index.references,
      mentionsByPage: [...index.mentionsByPage],
      bodyFontSize: index.bodyFontSize,
      fingerprint: index.fingerprint,
    });
  } catch (err) {
    post({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
});
