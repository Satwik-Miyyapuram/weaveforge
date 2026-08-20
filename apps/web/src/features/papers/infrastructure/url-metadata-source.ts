import type { IMetadataSource, PaperMetadata, PaperRef } from "@weaveforge/core";
import { authHeaders } from "@/lib/auth-headers";

/**
 * URL metadata source. Resolves an arbitrary paper URL to metadata by reading
 * the page's citation meta tags (via the `/api/url-meta` proxy, which fetches
 * and parses server-side). Implements IMetadataSource so it registers beside
 * arXiv/Crossref/Zotero (Open/Closed).
 *
 * The call carries the reader's token. That route fetches whatever address it
 * is given, from inside our network, so it asks who is calling — and a source
 * that did not say would simply stop working with a 401.
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
    /** Injected so a test can drive this without a session. */
    private readonly headers: () => Promise<HeadersInit> = authHeaders,
  ) {}

  supports(ref: PaperRef): boolean {
    return ref.kind === "url";
  }

  async fetch(ref: PaperRef): Promise<PaperMetadata> {
    const res = await this.fetchFn(`${this.baseUrl}?url=${encodeURIComponent(ref.value.trim())}`, {
      headers: await this.headers(),
    });
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
