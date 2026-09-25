import {
  extractPageMetadata,
  isPlaceholderTitle,
  pageImportRefusal,
  titleFromFileName,
  type IMetadataSource,
  type PaperMetadata,
  type PaperRef,
} from "@weaveforge/core";
import { authHeaders } from "@/lib/auth-headers";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { HTML_FINAL_URL_HEADER, HTML_PROXY_PATH } from "@/features/reader/application/paper-html-rules";

/**
 * URL metadata source. Resolves an arbitrary paper URL to metadata by reading
 * the page's citation meta tags (via the `/api/url-meta` proxy, which fetches
 * and parses server-side). Implements IMetadataSource so it registers beside
 * arXiv/Crossref/Zotero (Open/Closed).
 *
 * The call carries the reader's token. That route fetches whatever address it
 * is given, from inside our network, so it asks who is calling — and a source
 * that did not say would simply stop working with a 401.
 *
 * The desktop app has no server routes. There the page is fetched through the
 * shell's HTML relay and read with the same parser the route uses
 * (`extractPageMetadata`), so a link imports the same way in both builds.
 *
 * A research blog post or essay is a paper too: it carries no citation tags,
 * but says it is an article (JSON-LD, OpenGraph), and is accepted on that.
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
    /** Whether to read the page here, through the shell's relay. */
    private readonly inShell: () => boolean = () => desktop() !== null,
  ) {}

  supports(ref: PaperRef): boolean {
    return ref.kind === "url";
  }

  async fetch(ref: PaperRef): Promise<PaperMetadata> {
    const d = this.inShell() ? await this.readInShell(ref.value.trim()) : await this.readViaRoute(ref.value.trim());
    return this.toMetadata(d);
  }

  /** The desktop path: the relay fetches the page, the parser runs here. */
  private async readInShell(value: string): Promise<UrlMetaResponse> {
    const target = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
    let res: Response;
    try {
      res = await this.fetchFn(`${HTML_PROXY_PATH}?url=${encodeURIComponent(target)}`);
    } catch {
      throw new Error("Could not reach that site. Check the connection and try again.");
    }
    if (!res.ok) {
      // The relay answers `{ error }`; show its words, not the JSON around them.
      const detail = await res
        .json()
        .then((body: { error?: string }) => body?.error?.trim().slice(0, 200) ?? "")
        .catch(() => "");
      if (res.status === 415) {
        throw new Error("That link is not a web page. If it is a PDF, add the paper by DOI or arXiv id and use Load PDF….");
      }
      if (res.status === 400) throw new Error(detail || "That address cannot be fetched. Use an https link.");
      if (res.status === 403) throw new Error("That site refused the request. Try the DOI or arXiv id instead.");
      throw new Error(`Could not read that page${detail ? `: ${detail}` : ` (${res.status})`}.`);
    }
    const html = await res.text();
    const meta = extractPageMetadata(html, res.headers.get(HTML_FINAL_URL_HEADER) || target);
    const refusal = pageImportRefusal(meta);
    if (refusal) throw new Error(refusal);
    return meta;
  }

  private async readViaRoute(value: string): Promise<UrlMetaResponse> {
    const res = await this.fetchFn(`${this.baseUrl}?url=${encodeURIComponent(value)}`, {
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
    return (await res.json()) as UrlMetaResponse;
  }

  private toMetadata(d: UrlMetaResponse): PaperMetadata {
    if (!d.title) {
      throw new Error("That page has no title to file the paper under. Add the paper manually.");
    }
    // A page with no citation tags falls back to its <title>, which on a
    // publisher's PDF viewer or catalogue is the site's name for the page, not
    // the paper's. Imported, it becomes a row called "Catalog Page".
    if (isPlaceholderTitle(d.title)) {
      throw new Error(
        `That page is titled "${d.title.trim()}", which names the page, not a paper. Add it by DOI or arXiv id instead.`,
      );
    }
    return {
      title: titleFromFileName(d.title),
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
