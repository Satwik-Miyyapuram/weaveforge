/**
 * WebDAV ladder step — credentials must be server-sealed; this resolver only
 * emits a sealed URL shape when metadata declares a path. No credentials here.
 */

import { rust } from "../shared/rust.js";
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
    return rust().webdavSupports(typeof path === "string" ? path : undefined);
  }

  async resolve(paper: PdfSourcePaper): Promise<PdfSourceHit | null> {
    const path = rust().trimmedOrNone(String(paper.metadata?.["webdavPath"] ?? ""));
    if (!path) return null;
    const url = rust().trimmedOrNone(this.options.buildProxiedUrl(path));
    if (!url) return null;
    return { url };
  }
}
