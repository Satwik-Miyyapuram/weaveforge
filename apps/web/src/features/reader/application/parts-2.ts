import { HTML_FINAL_URL_HEADER, HTML_PROXY_PATH } from "./paper-html-rules";
import { getContainer } from "@/bootstrap";
import { NibFilter } from "@/features/ink/application/parts-2";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { relayUrl } from "@/lib/parts";
import { loadCore, readyCore, typedCore } from "@/lib/rust-core";
import {
  type AddPaperResult,
  findOpenAccessCopies,
  type IPaperIdentityLookup,
  type IPaperRepository,
  type NewPaperInput,
  type NewPaperRelationInput,
  type OpenAccessHttp,
  type OpenAccessIds,
  type PageProjection,
  type PaperIdentity,
  type PaperMetadata,
  type PaperRef,
  type PaperStatus,
  type ParsedReference,
  type ReaderAnnotation,
  ValidationError,
} from "@weaveforge/core";
import {
  layoutMarginNotes as layoutMarks,
  type MarginMark,
  type MarginSlot,
  picturePath,
} from "@weaveforge/wasm";
import { findFreeCopy, type FreeCopyOutcome, type HtmlFetchResult } from "./parts-1";
import { pdfProxyNeedsToken } from "./parts";
import { fetchTypedPdfToCache } from "./parts-3";

// --- free-copy-browser ---
/**
 * The browser's wiring for "Find a free copy": the network, the stores and the
 * sanitiser behind the ports `find-free-copy.ts` takes.
 *
 * The indexes are asked directly — every one of them sends CORS headers. The
 * copies they list are fetched the way a typed address is: PDFs through
 * `fetchTypedPdfToCache` (the shell's relay on desktop, the proxy or a direct
 * CORS fetch on the web), pages through the HTML relay.
 */
const INDEX_TIMEOUT_MS = 12_000;

/** JSON from an index: `null` for "not here" (404), a throw for "could not ask". */
export function openAccessHttp(fetchFn: typeof fetch = fetch): OpenAccessHttp {
  return async (url) => {
    const res = await fetchFn(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
    return res.json();
  };
}

/**
 * Fetch a paper's web page as text.
 *
 * Always through a relay, because a blog or a journal page almost never sends
 * CORS headers. Desktop: the shell's relay, any https host. Web: the server's
 * relay, which fetches the open-access hosts it knows directly and any other
 * page through its address-guarded fetch, within a per-user budget.
 */
export async function fetchPaperHtml(
  url: string,
  fetchFn: typeof fetch = fetch,
  getAccessToken: () => Promise<string | null> = () => getContainer().auth.auth.getAccessToken(),
): Promise<HtmlFetchResult> {
  let res: Response;
  try {
    const headers: Record<string, string> = {};
    if (desktop() === null && pdfProxyNeedsToken()) {
      const token = await getAccessToken();
      if (!token) return { ok: false, reason: "failed" };
      headers.Authorization = `Bearer ${token}`;
    }
    res = await fetchFn(`${relayUrl(HTML_PROXY_PATH)}?url=${encodeURIComponent(url)}`, { headers });
  } catch {
    return { ok: false, reason: "failed" };
  }
  if (!res.ok) {
    if (res.status === 415) return { ok: false, reason: "not-html", status: res.status };
    // The site itself said no (403), or its address is one the relay will not
    // dial (400): the page is there, just not to us.
    return { ok: false, reason: res.status === 403 || res.status === 400 ? "blocked" : "failed", status: res.status };
  }
  const raw = await res.text();
  const finalUrl = res.headers.get(HTML_FINAL_URL_HEADER) || url;
  return { ok: true, raw, finalUrl };
}

/** The user's OpenAlex key; none when settings cannot be read (signed out, locked). */
async function openAlexKey(): Promise<string | undefined> {
  try {
    const settings = await getContainer().settings.manageSettings.get();
    return typedCore().getUserIntegrationField(settings, "semantic-scholar", "openAlexKey");
  } catch {
    return undefined;
  }
}

/** Run the search for one paper with the real network and stores. */
export async function findFreeCopyInBrowser(paperId: string, ids: OpenAccessIds): Promise<FreeCopyOutcome> {
  const [{ sanitizePaperHtml }, { paperHtmlStore }] = await Promise.all([
    import("../infrastructure/sanitize-paper-html"),
    import("../infrastructure/paper-html-store"),
  ]);
  return findFreeCopy(paperId, ids, {
    lookup: async (lookupIds) =>
      findOpenAccessCopies(lookupIds, {
        http: openAccessHttp(),
        unpaywallEmail: process.env.NEXT_PUBLIC_UNPAYWALL_EMAIL,
        openAlexKey: await openAlexKey(),
      }),
    fetchPdf: (id, url) => fetchTypedPdfToCache(id, url),
    fetchHtml: (url) => fetchPaperHtml(url),
    sanitize: sanitizePaperHtml,
    saveHtml: async (page) => {
      const store = paperHtmlStore();
      if (!store) throw new Error("No store for web pages");
      await store.set(page);
    },
  });
}

// --- margin-notes ---
/** One comment card in the writing margin beside a page, and where it sits. */
export interface MarginNote {
  annotation: ReaderAnnotation;
  /** Screen offset from the top of the page, after stacking. */
  top: number;
  /** Where the mark it belongs to starts, before stacking — for the leader line. */
  anchorTop: number;
}

/** Height a card is assumed to take before it is measured; stacking uses it. */
export const MARGIN_NOTE_HEIGHT = 64;

/** The annotation's zotero position as the layout reads it, or null when it has none. */
function markGeometry(annotation: ReaderAnnotation): MarginMark["geometry"] {
  const position = annotation.anchor.zoteroPosition;
  if (!position) return null;
  return { rects: position.rects ?? [], paths: position.paths ?? [] };
}

/**
 * The comments on one page, laid out down the margin beside it: each card
 * level with the mark it annotates, pushed down only as far as the card
 * above it needs. Marks without a comment are not shown — the margin is for
 * what was said about the page, and the highlight itself is already on it.
 * The rules live in Rust (`layoutMarginNotes`); this maps annotations to marks.
 */
export function layoutMarginNotes(
  annotations: readonly ReaderAnnotation[],
  projection: PageProjection,
  cardHeight = MARGIN_NOTE_HEIGHT,
): MarginNote[] {
  const marks: MarginMark[] = annotations.map((annotation) => ({
    hasComment: annotation.comment.trim().length > 0,
    // A placed picture keeps its file in the comment; it is drawn on the page, not in the margin.
    hasPicture: Boolean(picturePath(annotation)),
    geometry: markGeometry(annotation),
  }));
  return layoutMarks(marks, projection, cardHeight).map((slot: MarginSlot) => ({
    annotation: annotations[slot.index]!,
    // Rust f64 comes back null only for NaN; keep the old NaN.
    top: slot.top ?? Number.NaN,
    anchorTop: slot.anchorTop ?? Number.NaN,
  }));
}

// --- pdf-ink-sampler ---
/** 0.1 mm per PDF point: the notes' filter is tuned in tenths of a millimetre. */
const TENTHS_PER_PT = (25.4 / 72) * 10;

/** Smallest gap kept between PDF ink samples, in points (~0.09 mm). */
export const PDF_INK_MIN_POINT_DISTANCE = 0.25;

/** RDP tolerance when a PDF stroke is saved, in points: sub-pixel, so the stroke keeps its shape. */
export const PDF_INK_SAVE_TOLERANCE = 0.1;

/**
 * The notes' pen pipeline for a PDF stroke: every sample (coalesced ones too)
 * through the same One Euro filter, so a paper and a note ink alike.
 */
export class PdfInkSampler {
  private readonly filter = new NibFilter();
  readonly path: number[] = [];

  /** Start a stroke at a PDF point. */
  begin(x: number, y: number, t: number): void {
    this.filter.reset();
    this.path.length = 0;
    this.push(x, y, t);
  }

  /** Filter one PDF-space sample; returns whether the path grew. */
  push(x: number, y: number, t: number): boolean {
    const at = Number.isFinite(t) ? t : performance.now();
    const out = this.filter.filter({ x: x * TENTHS_PER_PT, y: y * TENTHS_PER_PT, pressure: 0, t: at });
    const fx = out.x / TENTHS_PER_PT;
    const fy = out.y / TENTHS_PER_PT;
    if (!readyCore().shouldAppendInkPoint(this.path, fx, fy, PDF_INK_MIN_POINT_DISTANCE)) return false;
    this.path.push(fx, fy);
    return true;
  }

  /** Append an exact point (the page-edge cut), unfiltered. */
  pushExact(x: number, y: number): void {
    if (readyCore().shouldAppendInkPoint(this.path, x, y, PDF_INK_MIN_POINT_DISTANCE)) this.path.push(x, y);
  }

  clear(): void {
    this.path.length = 0;
  }
}

/** The samples a pointermove carries: its coalesced events, or itself. */
export function coalescedSamples(event: PointerEvent): PointerEvent[] {
  try {
    const list = event.getCoalescedEvents?.();
    if (list && list.length > 0) return list;
  } catch {
    // Some hosts throw on untrusted events.
  }
  return [event];
}

// --- reference-actions ---
/**
 * The popover's intents, mapped onto use-cases.
 *
 * The component is presentation only and the reader owns positioning; this is
 * the one place that knows which repository a "Read later" click ends up in.
 * Dependencies are narrowed to the methods actually used, so the module can be
 * tested against fakes and does not drag the whole container into a test.
 */
export interface ReferenceActionDeps {
  /** Resolves metadata for a DOI/arXiv/title reference and adds it. */
  importPaper: { importRef(ref: PaperRef, status?: PaperStatus): Promise<AddPaperResult> };
  /** Adds a paper from known fields, deduping against the library. */
  addPaper: { add(input: NewPaperInput): Promise<AddPaperResult> };
  relations: { add(input: NewPaperRelationInput): Promise<unknown> };
}

export function createReferenceActions(deps: ReferenceActionDeps) {
  /**
   * Add the record the popover resolved, when there is one. Searching the
   * entry's title again could land on another paper than the one shown, and a
   * neighbouring entry would then read "in library" for a paper it never cited.
   */
  const add = (entry: ParsedReference, metadata: PaperMetadata | undefined) =>
    metadata ? deps.addPaper.add(metadata) : deps.importPaper.importRef(readyCore().referenceRef(entry));

  return {
    /**
     * Put the cited paper on the shelf with the library's default status. The
     * popover is a footnote, not a triage tool: choosing a reading list from
     * here was a detour, and lists remain a library-side action.
     */
    addToLibrary: (entry: ParsedReference, metadata?: PaperMetadata): Promise<AddPaperResult> =>
      add(entry, metadata),

    /** Unresolved entry: no metadata anywhere, so add what the text gives us. */
    addManually: (entry: ParsedReference): Promise<AddPaperResult> =>
      deps.addPaper.add(readyCore().manualInputFromReference(entry)),

    /**
     * State B's link action: `citingPaper` cites `citedPaper`. The use-case is
     * idempotent, so a double click or a second visit cannot duplicate the edge.
     */
    linkPapers: (citingPaperId: string, citedPaperId: string): Promise<unknown> => {
      if (citingPaperId === citedPaperId) {
        return Promise.reject(new ValidationError("A paper cannot cite itself."));
      }
      return deps.relations.add({
        fromPaper: citingPaperId,
        toPaper: citedPaperId,
        relation: "cites",
        source: "manual",
      });
    },
  };
}

// --- reference-lookup ---
/**
 * What the panel shows when a cited paper is already in the library.
 *
 * `PaperIdentity`, not `Paper`: the popover and the panel read the *status* (so
 * they can say "in library · read") and the id, and nothing else. Typing it as a
 * full paper was a promise the lookup paid for in columns — a bibliography walk
 * transferred the abstract, the bibtex and the metadata bag of every reference it
 * recognised. A `Paper` still satisfies this, so the places that build a
 * resolution from a freshly added paper are unaffected.
 */
export type ResolvedReference =
  | { status: "resolved"; metadata: PaperMetadata; inLibrary?: PaperIdentity; sourceId: string }
  | { status: "unresolved" }
  | { status: "pending" };

export interface ReferenceLookupCache {
  get(key: string): Promise<ResolvedReference | undefined> | ResolvedReference | undefined;
  set(key: string, value: ResolvedReference): Promise<void> | void;
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// 5: misses are no longer stored; the bump drops the ones v4 kept.
const CACHE_SCHEMA = 5;
/** How long one library listing answers title matches: a bibliography walk, not a session. */
const LIBRARY_LIST_TTL_MS = 30_000;

function cacheKey(documentKey: string, refIndex: number): string {
  return `v${CACHE_SCHEMA}:${documentKey}:ref:${refIndex}`;
}

/**
 * Resolves parsed bibliography entries to metadata. The entry is offered to
 * the resolver in the order the identifiers trust: DOI first, then arXiv id,
 * then a title (+authors, year) search — and each form falls through to the
 * next when it fails, so an entry whose DOI the providers do not know still
 * resolves by its title. With the reader's resolver, Semantic Scholar is the
 * first provider for all three forms, with OpenAlex/Crossref behind it.
 * Results are cached per (documentKey, refIndex) with a 30-day TTL and
 * lazily stamped with time. The document key is the text layer's fingerprint
 * rather than the paper id, so two copies of one paper — or a re-upload —
 * share one set of lookups.
 */
export class ReferenceLookupService {
  private readonly memory = new Map<string, { at: number; value: ResolvedReference }>();
  private library?: { at: number; list: ReturnType<IPaperRepository["listSummaries"]> };

  constructor(
    private readonly resolver: { resolveWithSource(ref: PaperRef): Promise<{ metadata: PaperMetadata; sourceId: string }> },
    /** The identity of a paper the library already has; see `IPaperIdentityLookup`. */
    private readonly papers: IPaperIdentityLookup & Pick<IPaperRepository, "listSummaries">,
    private readonly cache?: ReferenceLookupCache,
    private readonly now: () => number = () => Date.now(),
  ) {}

  resolve(documentKey: string, ref: ParsedReference): Promise<ResolvedReference> {
    const key = cacheKey(documentKey, ref.index);
    const hit = this.memory.get(key);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value);
    return (async () => {
      const cached = await this.cache?.get(key);
      if (cached) {
        // Whether the paper is in the library is a fact about this workspace,
        // not the reference, so it is re-read rather than trusted from disk.
        const value = cached.status === "resolved"
          ? { ...cached, inLibrary: await this.libraryMatch(cached.metadata) }
          : cached;
        this.memory.set(key, { at: this.now(), value });
        return value;
      }
      const value = await this.lookup(ref);
      this.memory.set(key, { at: this.now(), value });
      // Only a hit is kept across sessions: a miss may be a dropped
      // connection, or an entry a later parser reads better.
      if (value.status === "resolved") void this.cache?.set(key, value);
      return value;
    })();
  }

  private async lookup(ref: ParsedReference): Promise<ResolvedReference> {
    if (!ref.doi && !ref.arxivId && !ref.title) return { status: "unresolved" };
    // Every shape the entry can be asked for, strongest identifier first; a
    // form that fails (unknown DOI, no search match) hands over to the next.
    const attempts: PaperRef[] = [];
    if (ref.doi) attempts.push({ kind: "doi", value: ref.doi });
    if (ref.arxivId) attempts.push({ kind: "arxiv", value: ref.arxivId });
    if (ref.title) {
      attempts.push({
        kind: "bibliographic",
        value: ref.title,
        hints: {
          title: ref.title,
          ...(ref.year != null ? { year: ref.year } : {}),
          ...(ref.authors[0] ? { firstAuthor: ref.authors[0] } : {}),
        },
      });
    }
    for (const attempt of attempts) {
      let found: { metadata: PaperMetadata; sourceId: string };
      try {
        found = await this.resolver.resolveWithSource(attempt);
      } catch {
        continue; // try the next form of the same entry
      }
      return { status: "resolved", ...found, inLibrary: await this.libraryMatch(found.metadata) };
    }
    return { status: "unresolved" };
  }

  /**
   * The library's copy, or none when the library cannot be read: a failed
   * listing says nothing about the reference, which is still resolved.
   */
  private async libraryMatch(metadata: PaperMetadata): Promise<PaperIdentity | undefined> {
    try {
      return await this.findInLibrary(metadata);
    } catch {
      return undefined;
    }
  }

  private async findInLibrary(metadata: PaperMetadata): Promise<PaperIdentity | undefined> {
    if (metadata.doi) return (await this.papers.findIdentityByDoi(metadata.doi)) ?? undefined;
    if (metadata.arxivId) return (await this.papers.findIdentityByArxivId(metadata.arxivId)) ?? undefined;
    return this.findByTitle(metadata.title);
  }

  /**
   * The add step's rule for a paper with no id: the same long title is the
   * same paper. Matching it here too is what lets the popover say "In library"
   * for a paper the add step would answer with "Already in library".
   */
  private async findByTitle(title: string): Promise<PaperIdentity | undefined> {
    const core = await loadCore();
    const key = core.titleKey(title);
    if (!key) return undefined;
    const match = (await this.librarySummaries()).find((p) => core.titleKey(p.title) === key);
    return match ? { id: match.id, title: match.title, status: match.status } : undefined;
  }

  /** One listing per short window, so a reference walk is not one fetch per entry. */
  private librarySummaries(): ReturnType<IPaperRepository["listSummaries"]> {
    const at = this.now();
    if (this.library && at - this.library.at < LIBRARY_LIST_TTL_MS) return this.library.list;
    const list = this.papers.listSummaries();
    const entry = { at, list };
    this.library = entry;
    // A failed listing must not answer the next lookup too.
    list.catch(() => { if (this.library === entry) this.library = undefined; });
    return list;
  }
}
