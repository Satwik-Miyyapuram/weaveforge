import type { IMetadataSource, PaperMetadata, PaperRef } from "@thesis/core";

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
      const detail = await res.text().catch(() => "");
      throw new Error(`Could not read that URL (${res.status}). ${detail}`.trim());
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
