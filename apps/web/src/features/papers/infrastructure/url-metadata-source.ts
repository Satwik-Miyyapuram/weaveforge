import {
  type IMetadataSource,
  type PaperMetadata,
  type PaperRef,
  paperInputWithoutNulls,
} from "@weaveforge/core";
import { authHeaders } from "@/lib/auth-headers";
import { formatError } from "@/lib/format-error";
import { desktop } from "@/lib/desktop/desktop-bridge";
import type { UrlMetaResponse } from "@weaveforge/wasm";
import { loadCore } from "@/lib/rust-core";
import { HTML_FINAL_URL_HEADER, HTML_PROXY_PATH } from "@/features/reader/application/paper-html-rules";
import { relayUrl } from "@/lib/relay-url";

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

export class UrlMetadataSource implements IMetadataSource {
  readonly id = "url";

  constructor(
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly baseUrl = relayUrl("/api/url-meta"),
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
    const core = await loadCore();
    return paperInputWithoutNulls(core.urlMetaToMetadata(d));
  }

  /** The desktop path: the relay fetches the page, the parser runs here. */
  private async readInShell(value: string): Promise<UrlMetaResponse> {
    const core = await loadCore();
    const target = core.urlMetaShellTarget(value);
    let res: Response;
    try {
      res = await this.fetchFn(`${relayUrl(HTML_PROXY_PATH)}?url=${encodeURIComponent(target)}`);
    } catch (err) {
      throw new Error(`Could not reach that site. Check the connection and try again. (${formatError(err)})`);
    }
    if (!res.ok) {
      // The relay answers `{ error }`; show its words, not the JSON around them.
      const detail = await res
        .json()
        .then((body: { error?: string }) => body?.error?.trim().slice(0, 200) ?? "")
        .catch(() => "");
      throw new Error(core.urlMetaReadFailureMessage(res.status, detail));
    }
    const html = await res.text();
    // The meta tags are in the head, so a page over the Rust input limit is cut, not refused.
    const meta = core.extractPageMetadata(html.slice(0, core.maxIndexTextUtf16()), res.headers.get(HTML_FINAL_URL_HEADER) || target);
    const refusal = core.pageImportRefusal(meta);
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

}
