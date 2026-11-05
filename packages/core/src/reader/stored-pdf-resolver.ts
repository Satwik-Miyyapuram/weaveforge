/**
 * Our-storage ladder step: a signed URL for the paper's PDF in WeaveForge
 * storage. It costs us bandwidth, so the composition root registers it last.
 */

import type { IPdfSourceResolver, PdfSourceHit, PdfSourcePaper } from "./pdf-source-ladder.js";

export interface StoredPdfResolverOptions {
  /** Signed URL for the paper's stored PDF, or null when none is stored. */
  signedUrl: (paperId: string) => Promise<string | null>;
}

export class StoredPdfResolver implements IPdfSourceResolver {
  readonly id = "server-blob";

  constructor(private readonly options: StoredPdfResolverOptions) {}

  supports(_paper: PdfSourcePaper): boolean {
    return true;
  }

  async resolve(paper: PdfSourcePaper): Promise<PdfSourceHit | null> {
    const url = (await this.options.signedUrl(paper.id))?.trim();
    return url ? { url } : null;
  }
}
