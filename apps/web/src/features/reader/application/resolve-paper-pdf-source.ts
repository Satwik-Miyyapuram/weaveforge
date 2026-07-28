/**
 * Build the PDF source ladder for the web reader.
 * Composition root lives here so core stays free of web allowlists.
 */

import {
  OpenAccessPdfResolver,
  resolvePdfSource,
  type PdfSourcePaper,
  type PdfSourceResolution,
} from "@thesis/core";
import { resolvePaperPdfUrl } from "./sanitize-reader-url";

export function paperToPdfSourcePaper(input: {
  id: string;
  url?: string | null;
  arxivId?: string | null;
  doi?: string | null;
  pdfPath?: string | null;
  metadata?: Record<string, unknown>;
}): PdfSourcePaper {
  return {
    id: input.id,
    url: input.url ?? undefined,
    arxivId: input.arxivId ?? undefined,
    doi: input.doi ?? undefined,
    metadata: {
      ...(input.metadata ?? {}),
      ...(input.pdfPath ? { pdfPath: input.pdfPath } : {}),
    },
  };
}

const openAccessResolver = new OpenAccessPdfResolver({
  resolveUrl: (paper) =>
    resolvePaperPdfUrl({
      url: paper.url,
      arxivId: paper.arxivId,
      pdfPath: typeof paper.metadata?.["pdfPath"] === "string" ? paper.metadata["pdfPath"] : null,
    }),
});

/** Resolvers in priority order — cost-bearing sources must be appended last later. */
export function defaultPdfSourceResolvers() {
  return [openAccessResolver] as const;
}

export function resolvePaperPdfSource(
  paper: Parameters<typeof paperToPdfSourcePaper>[0],
): Promise<PdfSourceResolution> {
  return resolvePdfSource(paperToPdfSourcePaper(paper), defaultPdfSourceResolvers());
}
