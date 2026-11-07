/**
 * Build the PDF source ladder for the web reader.
 * Composition root lives here so core stays free of web allowlists.
 */

import {
  GitHubRepoPdfResolver,
  OpenAccessPdfResolver,
  PdfByteCacheResolver,
  WebDavPdfResolver,
  resolvePdfSource,
  type GitHubRepoPdfResolverOptions,
  type IPdfByteCache,
  type IPdfSourceResolver,
  type PdfSourcePaper,
  type PdfSourceResolution,
} from "@weaveforge/core";
import { desktop } from "@/lib/desktop/desktop-bridge";
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
}

/** The desktop shell's route for a file in the sync repo (`apps/shell/src/github_file.rs`). */
const GITHUB_FILE_ROUTE = "/api/github-file";
const GITHUB_PROBE_MS = 60_000;
let githubProbe: { at: number; set: boolean } | null = null;

/**
 * The GitHub step's source: in the desktop shell, when its sync remote is on
 * GitHub. The shell holds the token and fetches the file; the page only names
 * the repo path. The answer is kept a minute so a library sweep asks once.
 */
export async function githubRemotePdfSources(
  deps: { isDesktop?: boolean; fetchFn?: typeof fetch; now?: () => number } = {},
): Promise<RemotePdfSources> {
  const isDesktop = deps.isDesktop ?? desktop() !== null;
  if (!isDesktop) return {};
  const now = (deps.now ?? Date.now)();
  if (!githubProbe || now - githubProbe.at >= GITHUB_PROBE_MS) {
    let set = false;
    try {
      set = (await (deps.fetchFn ?? fetch)(GITHUB_FILE_ROUTE)).status === 204;
    } catch {
      set = false;
    }
    githubProbe = { at: now, set };
  }
  if (!githubProbe.set) return {};
  return { githubFileUrl: (path) => `${GITHUB_FILE_ROUTE}?path=${encodeURIComponent(path)}` };
}

/**
 * Resolvers in priority order: cache, open access, GitHub repo, WebDAV.
 * PDFs are never stored on our server, so there is no our-storage step.
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
  return resolvers;
}

export function resolvePaperPdfSource(
  paper: Parameters<typeof paperToPdfSourcePaper>[0],
  cache?: IPdfByteCache,
  remote?: RemotePdfSources,
): Promise<PdfSourceResolution> {
  return resolvePdfSource(paperToPdfSourcePaper(paper), defaultPdfSourceResolvers(cache, remote));
}
