/**
 * Open-access / landing-URL PDF resolver — ladder step for public https PDFs.
 * Pure: no I/O beyond what the caller already put on the paper shape.
 */

import type { IPdfSourceResolver, PdfSourceHit, PdfSourcePaper } from "./pdf-source-ladder.js";

export interface OpenAccessPdfResolverOptions {
  /**
   * Map paper fields → a PDF https URL, or null when none can be derived.
   * Injected so the web allowlist (`sanitizePdfUrl` / `looksLikePdfUrl`) stays
   * in the app layer while the resolver itself stays framework-free.
   */
  resolveUrl: (paper: PdfSourcePaper) => string | null;
}

export class OpenAccessPdfResolver implements IPdfSourceResolver {
  readonly id = "open-access";

  constructor(private readonly options: OpenAccessPdfResolverOptions) {}

  supports(paper: PdfSourcePaper): boolean {
    return Boolean(paper.arxivId?.trim() || paper.url?.trim() || paper.doi?.trim());
  }

  async resolve(paper: PdfSourcePaper): Promise<PdfSourceHit | null> {
    const url = this.options.resolveUrl(paper)?.trim();
    if (!url) return null;
    return { url };
  }
}
