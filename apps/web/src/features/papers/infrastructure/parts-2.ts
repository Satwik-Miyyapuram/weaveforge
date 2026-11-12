import { authHeaders } from "@/lib/auth-headers";
import { desktop, type DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";
import { relayUrl } from "@/lib/parts";
import { loadCore, readyCore } from "@/lib/rust-core";
import { fetchSemanticScholar, semanticScholarUrl } from "@/lib/semantic-scholar-fetch";
import {
  errorMessage,
  type IMetadataSource,
  type Paper,
  paperInputWithoutNulls,
  type PaperMetadata,
  type PaperRef,
} from "@weaveforge/core";
import type {
  SemanticScholarPaper,
  UrlMetaResponse,
  ZoteroAnnotation,
  ZoteroItemRow,
} from "@weaveforge/wasm";
import type { ZoteroAnnotationPull } from "../domain/zotero";
import {
  fetchAllZoteroItems,
  fetchZoteroItemKeys,
  isChildItem,
  zoteroHeaders,
  type ZoteroItemData,
  zoteroLibraryUrl,
  ZoteroSync,
  type ZoteroSyncDeps,
  zoteroTopLevelPath,
} from "./parts-3";

export type { ZoteroAnnotation } from "@weaveforge/wasm";

// --- semantic-scholar-metadata-source ---
/**
 * Semantic Scholar as a metadata provider.
 *
 * Three doors in, one API out: a DOI goes to `paper/DOI:…`, an arXiv id to
 * `paper/arXiv:…` — exact lookups, no search — and anything else through the
 * match endpoint built for "title (+authors, year) from a bibliography".
 * Identifier lookups make this the reader's first provider for DOI and arXiv
 * entries too, ahead of Crossref and OpenAlex. In the desktop shell the
 * request goes through the relay from #242 (`semanticScholarUrl`), never a
 * second direct network path.
 */
export class SemanticScholarMetadataSource implements IMetadataSource {
  readonly id = "semantic-scholar";

  constructor(
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    // Resolved per call: the desktop shell relays the API (see `semanticScholarUrl`).
    private readonly baseUrl?: string,
    private readonly apiKey: () => Promise<string | undefined> = async () => undefined,
  ) {}

  supports(ref: PaperRef): boolean {
    return ref.kind === "bibliographic" || ref.kind === "doi" || ref.kind === "arxiv";
  }

  async fetch(ref: PaperRef): Promise<PaperMetadata> {
    if (ref.kind === "doi" || ref.kind === "arxiv") {
      return this.fetchByIdentifier(ref.kind === "doi" ? "DOI" : "arXiv", ref.value);
    }
    if (ref.kind !== "bibliographic") throw new Error("Expected a bibliographic reference");
    const query = ref.hints?.title ?? ref.value;
    const core = await loadCore();
    const url = core.semanticScholarMatchUrl(this.baseUrl ?? semanticScholarUrl("graph/v1"), query);
    const key = await this.apiKey();
    const response = await fetchSemanticScholar(this.fetchFn, url, key ? { headers: { "x-api-key": key } } : undefined);
    if (!response.ok) throw new Error(`Semantic Scholar metadata failed: ${response.status}`);
    const body = await response.json() as { data?: SemanticScholarPaper[] };
    for (const paper of body.data ?? []) {
      if (!paper.title || !core.isBibliographicMatch(ref.hints ?? {}, { title: paper.title, year: paper.year ?? undefined })) continue;
      return paperInputWithoutNulls(core.semanticScholarToMetadata(paper));
    }
    throw new Error("No sufficiently similar Semantic Scholar match");
  }

  /** `paper/DOI:10.…` / `paper/arXiv:2305.12345` — a certain lookup, not a search. */
  private async fetchByIdentifier(kind: "DOI" | "arXiv", value: string): Promise<PaperMetadata> {
    const key = await this.apiKey();
    const url = (await loadCore()).semanticScholarIdentifierUrl(this.baseUrl ?? semanticScholarUrl("graph/v1"), kind, value);
    const response = await fetchSemanticScholar(this.fetchFn, url, key ? { headers: { "x-api-key": key } } : undefined);
    if (!response.ok) throw new Error(`Semantic Scholar ${kind} lookup failed: ${response.status}`);
    const paper = await response.json() as SemanticScholarPaper;
    if (!paper.title) throw new Error(`Semantic Scholar ${kind} lookup returned no paper`);
    const core = await loadCore();
    return paperInputWithoutNulls(core.semanticScholarToMetadata(paper));
  }
}

// --- url-metadata-source ---
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
      res = await this.fetchFn(`${relayUrl(core.htmlProxyPath())}?url=${encodeURIComponent(target)}`);
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
    const meta = core.extractPageMetadata(html.slice(0, core.maxIndexTextUtf16()), res.headers.get(core.htmlFinalUrlHeader()) || target);
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

// --- zotero-metadata-source ---
/**
 * Zotero metadata source. Resolves a Zotero item key to paper metadata via the
 * Zotero Web API. Implements IMetadataSource so it slots in beside arXiv and
 * Crossref (Open/Closed).
 *
 * Credentials are stored per-user (Settings page). This source reads them via
 * an injected provider and calls Zotero directly from the unlocked browser.
 * The WeaveForge server never receives the API key.
 */

interface ZoteroCredentials {
  apiKey?: string;
  library?: string;
  /** Per-project collection key — scopes sync push/pull to one collection. */
  collection?: string;
}

export type ZoteroCredentialsProvider = () => Promise<ZoteroCredentials>;

export class ZoteroMetadataSource implements IMetadataSource {
  readonly id = "zotero";

  constructor(
    private readonly credentials: ZoteroCredentialsProvider = async () => ({}),
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly apiOrigin = "https://api.zotero.org",
  ) {}

  supports(ref: PaperRef): boolean {
    return ref.kind === "zotero";
  }

  async fetch(ref: PaperRef): Promise<PaperMetadata> {
    const key = ref.value.trim();
    const creds = await this.credentials();
    if (!creds.apiKey || !creds.library) {
      throw new Error(
        "Zotero is not configured. Add your API key and library in Settings.",
      );
    }
    const headers = zoteroHeaders(creds.apiKey);
    const libraryUrl = zoteroLibraryUrl(creds.library, this.apiOrigin);
    const data = await this.readItem(libraryUrl, headers, key);

    // A key copied out of Zotero often points at the PDF, not the paper: the
    // attachment is what the reader has selected. Its title is "SAGE PDF Full
    // Text", it carries no DOI and no creators, and imported as-is it becomes a
    // nameless row in the library. Follow the parent instead — one extra
    // request, and the entry that results is the bibliography entry.
    if (isChildItem(data)) {
      if (!data.parentItem) {
        throw new Error(
          `Zotero item ${key} is a ${data.itemType ?? "child item"} with no parent entry, so it has no paper metadata to import.`,
        );
      }
      return paperInputWithoutNulls(readyCore().zoteroRemoteToMetadata(await this.readItem(libraryUrl, headers, data.parentItem)));
    }
    return paperInputWithoutNulls(readyCore().zoteroRemoteToMetadata(data));
  }

  private async readItem(
    libraryUrl: string,
    headers: Record<string, string>,
    key: string,
  ): Promise<ZoteroItemData> {
    const res = await this.fetchFn(`${libraryUrl}/items/${encodeURIComponent(key)}`, {
      headers,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Zotero request failed: ${res.status} ${detail}`.trim());
    }
    const body = (await res.json()) as { data?: ZoteroItemData };
    return body.data ?? {};
  }
}

// --- zotero-annotations ---
/**
 * Rust leaves absent fields out; the old TS always set comment, color and page,
 * undefined when Zotero had none. Keep those keys so the shape stays the same.
 */
function annotationWithKeys(ann: ZoteroAnnotation): ZoteroAnnotation {
  const mapped = Object.fromEntries(Object.entries(ann).map(([k, v]) => [k, v ?? undefined]));
  return { comment: undefined, color: undefined, page: undefined, ...mapped } as ZoteroAnnotation;
}

export class ZoteroAnnotations {
  constructor(
    private readonly credentials: ZoteroCredentialsProvider,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly apiOrigin = "https://api.zotero.org",
  ) {}

  /** The annotations, plus the PDF attachment each paper's annotations hang off. */
  async pull(): Promise<ZoteroAnnotationPull> {
    const creds = await this.credentials();
    if (!creds.apiKey || !creds.library) {
      throw new Error("Zotero is not configured. Add your API key and library in Settings.");
    }
    const headers = zoteroHeaders(creds.apiKey);
    const baseUrl = zoteroLibraryUrl(creds.library, this.apiOrigin);
    const col = creds.collection;

    // The four reads are independent of one another — the attachment map is
    // only needed to *join* annotations to papers, not to fetch them — so they
    // go out together. Run one after another, each waiting on the last page of
    // the one before, they were the whole cost of a sync.
    const items = (itemType: string | undefined, collection?: string) =>
      fetchAllZoteroItems<ZoteroItemRow>({
        baseUrl,
        headers,
        params: { itemType, collection },
        fetchFn: this.fetchFn,
        label: itemType ?? "items",
      });

    const [allowedPaperKeys, attachments, annotations, notes] = await Promise.all([
      col
        // Top-level only: this set gates which parents count as papers, so
        // letting attachment keys into it would defeat the collection scope.
        ? fetchZoteroItemKeys({ baseUrl, path: zoteroTopLevelPath(col), headers, fetchFn: this.fetchFn })
        : Promise.resolve(null),
      items("attachment"),
      items("annotation"),
      items("note"),
    ]);

    // The join (attachment -> paper, main PDF, annotation and note grouping) is
    // pure logic and lives in Rust. Only the log line below is I/O.
    const joined = readyCore().zoteroPullJoin(
      attachments,
      annotations,
      notes,
      allowedPaperKeys ? [...allowedPaperKeys] : null,
    );
    if (joined.choices.length) {
      logToApp({
        level: "info",
        source: "zotero.annotations",
        message: `Picked the main PDF for ${joined.choices.length} paper(s) with several PDFs`,
        detail: joined.choices.join("\n"),
      });
    }
    // Notes were never given the undefined-key shape, only highlights were.
    const withKeys = (ann: ZoteroAnnotation) => (ann.kind === "note" ? ann : annotationWithKeys(ann));
    return {
      byPaper: new Map(joined.byPaper.map(([paper, anns]) => [paper, anns.map(withKeys)])),
      attachments: new Map(joined.attachments),
    };
  }
}

// --- zotero-exporter ---
/**
 * Pushes a paper directly from the unlocked browser to Zotero. The Thesis
 * Tracker server never receives the decrypted Zotero key or write payload.
 */
export class ZoteroExporter {
  constructor(
    private readonly credentials: ZoteroCredentialsProvider = async () => ({}),
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly apiOrigin = "https://api.zotero.org",
  ) {}

  /** Create the item in Zotero; returns the new Zotero item key. */
  async save(paper: Paper): Promise<string | undefined> {
    const creds = await this.credentials();
    if (!creds.apiKey || !creds.library) {
      throw new Error(
        "Zotero is not configured. Add your API key and library in Settings.",
      );
    }
    const item = {
      ...readyCore().toZoteroItem(paper),
      ...(creds.collection ? { collections: [creds.collection] } : {}),
    };
    const res = await this.fetchFn(`${zoteroLibraryUrl(creds.library, this.apiOrigin)}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...zoteroHeaders(creds.apiKey),
        "Zotero-Write-Token": crypto.randomUUID().replace(/-/g, ""),
      },
      body: JSON.stringify([item]),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Zotero save failed (${res.status}). ${detail}`.trim());
    }
    const result = (await res.json()) as {
      failed?: Record<string, unknown>;
      successful?: Record<string, { key?: string }>;
    };
    if (result.failed && Object.keys(result.failed).length > 0) {
      throw new Error(`Zotero rejected the item: ${JSON.stringify(result.failed)}`);
    }
    return result.successful?.["0"]?.key;
  }

  /**
   * Delete the item from Zotero by its key — permanently, not to Zotero's
   * trash: the web API's DELETE removes the item outright. Absent already is
   * fine.
   *
   * Zotero refuses a single-item DELETE without `If-Unmodified-Since-Version`
   * (428), so the item's current version is read first. A 412 means it
   * changed between the read and the delete; one fresh read and retry settles
   * that, and a second 412 is an error rather than a silent success, because a
   * copy left in Zotero comes back as a duplicate on the next sync.
   */
  async remove(zoteroKey: string): Promise<void> {
    const creds = await this.credentials();
    if (!creds.apiKey || !creds.library) return; // not configured — nothing to do
    const url = `${zoteroLibraryUrl(creds.library, this.apiOrigin)}/items/${encodeURIComponent(zoteroKey)}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const head = await this.fetchFn(url, { headers: zoteroHeaders(creds.apiKey) });
      if (head.status === 404 || head.status === 410) return;
      if (!head.ok) {
        const detail = await head.text().catch(() => "");
        throw new Error(`Zotero delete failed (${head.status}). ${detail}`.trim());
      }
      const version = head.headers.get("Last-Modified-Version");
      const res = await this.fetchFn(url, {
        method: "DELETE",
        headers: {
          ...zoteroHeaders(creds.apiKey),
          ...(version ? { "If-Unmodified-Since-Version": version } : {}),
        },
      });
      if (res.ok || res.status === 404 || res.status === 410) return;
      if (res.status === 412 && attempt === 0) continue;
      const detail = await res.text().catch(() => "");
      throw new Error(`Zotero delete failed (${res.status}). ${detail}`.trim());
    }
  }
}

// --- zotero-local ---
/**
 * The Zotero on this computer, read through the desktop shell.
 *
 * Zotero 7 serves a read-only copy of the Web API on loopback. It speaks the
 * same JSON, so none of the parsing below this line is new: the pager, the
 * attachment-to-paper join and the annotation parser are the Web API's, given
 * a different origin and a fetch that goes over IPC instead of the network.
 *
 * Read-only is not a limitation we imposed. Zotero's local API answers GETs
 * and nothing else, so papers and annotations come in and nothing goes back
 * out — see `docs/using/integrations.md`.
 */

export const ZOTERO_LOCAL_API = "http://127.0.0.1:23119/api";
export const ZOTERO_LOCAL_LIBRARY = "users/0";

/** Zotero's local API wants no key. One is supplied because the shared header
 * builder requires it, and the local server ignores it. */
const UNUSED_KEY = "local";

/** What the local library hands the shared readers: the fixed origin, no key. */
const localCredentials = async (collection?: string) => ({
  apiKey: UNUSED_KEY,
  library: ZOTERO_LOCAL_LIBRARY,
  collection,
});

export const ZOTERO_NOT_RUNNING =
  "Zotero is not answering on this computer. Open Zotero, then try again.";

/**
 * A `fetch` that reaches only the local Zotero, via the shell.
 *
 * The reply is rebuilt into a real `Response` so everything downstream keeps
 * reading `res.ok`, `res.json()` and `res.headers.get("Total-Results")` — the
 * pager's backoff handling included — without knowing where it came from.
 *
 * Two things are done to the reply rather than handed on as they arrived:
 *
 *   * **The 403 becomes a sentence.** Every caller's next move with a non-ok
 *     response is to write `fetch failed (403)` and show it, which is the
 *     message this file exists to replace, and there are four callers — the item
 *     pager, the collections reader, the annotation reader and the write-back —
 *     so doing it here is one answer instead of four.
 *   * **A status the `Response` constructor refuses is translated.** The
 *     constructor takes only 200–599 and refuses 204, 205 and 304 outright, and
 *     the shell forwards Zotero's raw status. Zotero's Web API answers 304 to a
 *     conditional read, so a perfectly good answer used to arrive as
 *     `TypeError: Invalid response status code 304` from a line the caller had
 *     no reason to suspect. The wire status is kept beside it, so the message a
 *     caller composes still names what actually came back.
 */
export function zoteroLocalFetch(bridge: DesktopBridge): typeof fetch {
  return async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const reply = await bridge.zoteroLocal(url).catch((cause: unknown) => {
      // The bridge's own reason is kept. It used to be replaced wholesale with
      // "Zotero is not answering", which sent the reader to check a running
      // Zotero when the real cause was a shell too old to have the channel, a
      // refused origin, or a URL the guard rejected.
      const why = errorMessage(cause);
      throw new Error(`${ZOTERO_NOT_RUNNING} (${why})`);
    });
    const core = readyCore();
    const refused = core.zoteroLocalStatusMessage(reply.status);
    if (refused) throw new Error(refused);
    const status = core.usableStatus(reply.status);
    const headers = { ...reply.headers, ...(status === reply.status ? {} : { "x-weaveforge-status": String(reply.status) }) };
    return new Response(reply.body, { status, headers });
  };
}

/**
 * The local library's papers, ready to pull.
 *
 * Only `pull()` is meaningful here: a push is a POST the local API refuses,
 * and a delete-propagation against a library that may be a subset of the
 * cloud one would remove papers that are merely elsewhere.
 */
export function localZoteroLibrary(
  bridge: DesktopBridge,
  deps: Pick<ZoteroSyncDeps, "listPapers" | "addPaper" | "onItemTags">,
  collection?: () => Promise<string | undefined>,
): ZoteroSync {
  return new ZoteroSync({
    ...deps,
    credentials: async () => localCredentials(await collection?.()),
    fetchFn: zoteroLocalFetch(bridge),
    baseUrl: ZOTERO_LOCAL_API,
  });
}

/** Annotations from the local library, ready to pull. */
export function localZoteroAnnotations(
  bridge: DesktopBridge,
  collection?: () => Promise<string | undefined>,
): ZoteroAnnotations {
  return new ZoteroAnnotations(
    async () => localCredentials(await collection?.()),
    zoteroLocalFetch(bridge),
    ZOTERO_LOCAL_API,
  );
}
