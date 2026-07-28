/**
 * WebDAV ladder step — credentials must be server-sealed; this resolver only
 * emits a sealed URL shape when metadata declares a path. No credentials here.
 */

import type { IPdfSourceResolver, PdfSourceHit, PdfSourcePaper } from "./pdf-source-ladder.js";

export interface WebDavPdfResolverOptions {
  /**
   * Build a same-origin proxy URL for a WebDAV path. Composition root supplies
   * the sealed credential hop; this class never sees secrets.
   */
  buildProxiedUrl: (path: string) => string | null;
}

export class WebDavPdfResolver implements IPdfSourceResolver {
  readonly id = "webdav";

  constructor(private readonly options: WebDavPdfResolverOptions) {}

  supports(paper: PdfSourcePaper): boolean {
    const path = paper.metadata?.["webdavPath"];
    return typeof path === "string" && path.trim().length > 0;
  }

  async resolve(paper: PdfSourcePaper): Promise<PdfSourceHit | null> {
    const path = String(paper.metadata?.["webdavPath"] ?? "").trim();
    if (!path) return null;
    const url = this.options.buildProxiedUrl(path)?.trim();
    if (!url) return null;
    return { url };
  }
}
