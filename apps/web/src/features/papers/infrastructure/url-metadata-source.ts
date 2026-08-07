import type { IMetadataSource, PaperMetadata, PaperRef } from "@weaveforge/core";

/**
 * URL metadata source. Resolves an arbitrary paper URL to metadata by reading
 * the page's citation meta tags (via the `/api/url-meta` proxy, which fetches
 * and parses server-side). Implements IMetadataSource so it registers beside
 * arXiv/Crossref/Zotero (Open/Closed).
 */

interface UrlMetaResponse {
  title?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  abstract?: string;
  url: string;
}

export class UrlMetadataSource implements IMetadataSource {
  readonly id = "url";

  constructor(
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly baseUrl = "/api/url-meta",
  ) {}

  supports(ref: PaperRef): boolean {
    return ref.kind === "url";
  }

  async fetch(ref: PaperRef): Promise<PaperMetadata> {
    const res = await this.fetchFn(
      `${this.baseUrl}?url=${encodeURIComponent(ref.value.trim())}`,
    );
    if (!res.ok) {
      // The route explains *why* in `error`; show that rather than a status
      // code with a JSON blob glued to it.
      const detail = await res
        .json()
        .then((body: { error?: string }) => body?.error)
        .catch(() => undefined);
      throw new Error(detail ?? `Could not read that URL (${res.status}).`);
    }
    const d = (await res.json()) as UrlMetaResponse;
    if (!d.title) {
      throw new Error("No citation metadata found on that page.");
    }
    return {
      title: d.title,
      authors: d.authors ?? [],
      year: d.year,
      venue: d.venue,
      doi: d.doi,
      arxivId: d.arxivId,
      abstract: d.abstract,
      url: d.url,
    };
  }
}
