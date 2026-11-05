/**
 * Build the PDF source ladder for the web reader.
 * Composition root lives here so core stays free of web allowlists.
 */

import {
  GitHubRepoPdfResolver,
  OpenAccessPdfResolver,
  PdfByteCacheResolver,
  StoredPdfResolver,
  WebDavPdfResolver,
  resolvePdfSource,
  type GitHubRepoPdfResolverOptions,
  type IPdfByteCache,
  type StoredPdfResolverOptions,
  type IPdfSourceResolver,
  type PdfSourcePaper,
  type PdfSourceResolution,
} from "@weaveforge/core";
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
      openAccessPdf:
        typeof paper.metadata?.["openAccessPdf"] === "string" ? paper.metadata["openAccessPdf"] : null,
    }),
});

const webDavResolver = new WebDavPdfResolver({
  // No sealed WebDAV proxy route yet — refuse rather than return a 404 URL.
  buildProxiedUrl: () => null,
});

/** Remote copies the caller can reach; each step is skipped when absent. */
export interface RemotePdfSources {
  /** URL for a file in the workspace's GitHub repo, or null when none is set up. */
  githubFileUrl?: GitHubRepoPdfResolverOptions["buildFileUrl"];
  /** Signed URL for the PDF in our storage, or null when none is stored. */
  storedPdfUrl?: StoredPdfResolverOptions["signedUrl"];
}

/**
 * Resolvers in priority order: cache, open access, GitHub repo, WebDAV, then
 * our storage last because it costs us bandwidth.
 */
function defaultPdfSourceResolvers(
  cache?: IPdfByteCache,
  remote: RemotePdfSources = {},
): readonly IPdfSourceResolver[] {
  const resolvers: IPdfSourceResolver[] = [];
  if (cache) resolvers.push(new PdfByteCacheResolver(cache));
  resolvers.push(openAccessResolver);
  if (remote.githubFileUrl) resolvers.push(new GitHubRepoPdfResolver({ buildFileUrl: remote.githubFileUrl }));
  resolvers.push(webDavResolver);
  if (remote.storedPdfUrl) resolvers.push(new StoredPdfResolver({ signedUrl: remote.storedPdfUrl }));
  return resolvers;
}

export function resolvePaperPdfSource(
  paper: Parameters<typeof paperToPdfSourcePaper>[0],
  cache?: IPdfByteCache,
  remote?: RemotePdfSources,
): Promise<PdfSourceResolution> {
  return resolvePdfSource(paperToPdfSourcePaper(paper), defaultPdfSourceResolvers(cache, remote));
}
