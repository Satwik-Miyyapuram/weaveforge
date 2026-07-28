/**
 * Build the PDF source ladder for the web reader.
 * Composition root lives here so core stays free of web allowlists.
 */

import {
  OpenAccessPdfResolver,
  PdfByteCacheResolver,
  resolvePdfSource,
  type IPdfByteCache,
  type IPdfSourceResolver,
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

/** Resolvers in priority order — cache first when provided, then open-access. */
export function defaultPdfSourceResolvers(
  cache?: IPdfByteCache,
): readonly IPdfSourceResolver[] {
  const resolvers: IPdfSourceResolver[] = [];
  if (cache) resolvers.push(new PdfByteCacheResolver(cache));
  resolvers.push(openAccessResolver);
  return resolvers;
}

export function resolvePaperPdfSource(
  paper: Parameters<typeof paperToPdfSourcePaper>[0],
  cache?: IPdfByteCache,
): Promise<PdfSourceResolution> {
  return resolvePdfSource(paperToPdfSourcePaper(paper), defaultPdfSourceResolvers(cache));
}
