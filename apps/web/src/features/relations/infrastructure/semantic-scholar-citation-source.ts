import { typedCore } from "@/lib/rust-core";
import { fetchSemanticScholar, semanticScholarUrl } from "@/lib/semantic-scholar-fetch";

import type { CitationCandidate, ICitationSource, PaperRef } from "@weaveforge/core";

/**
 * Semantic Scholar citation source. Implements ICitationSource so it can be
 * registered with the LinkCitations use-case without changing it (Open/Closed).
 *
 * Uses the public Graph API; dependency-free (fetch + JSON). For each reference
 * it prefers the arXiv id, falling back to the DOI — matching how papers are
 * deduped locally.
 */

interface S2ExternalIds {
  ArXiv?: string;
  DOI?: string;
}

interface S2ReferenceItem {
  citedPaper?: { externalIds?: S2ExternalIds | null } | null;
}

interface S2ReferencesResponse {
  data?: S2ReferenceItem[];
}

/** `/paper/batch` item: a paper with its nested `references[].externalIds`. */
interface S2BatchItem {
  references?: { externalIds?: S2ExternalIds | null }[] | null;
}

interface S2Paper {
  paperId?: string | null;
  title?: string | null;
  authors?: { name?: string | null }[] | null;
  year?: number | null;
  url?: string | null;
  citationCount?: number | null;
}

interface S2CitationEdge {
  citingPaper?: S2Paper | null;
  contexts?: unknown;
  intents?: unknown;
  isInfluential?: unknown;
}

interface S2CitationsResponse {
  data?: S2CitationEdge[];
  next?: number;
}

function mapContexts(raw: unknown): string[] | undefined {
  return typedCore().citationContexts(raw);
}

function mapIntents(raw: unknown): CitationCandidate["intents"] | undefined {
  return typedCore().citationIntents(raw) as CitationCandidate["intents"] | undefined;
}

function mapIsInfluential(raw: unknown): boolean | undefined {
  return typeof raw === "boolean" ? raw : undefined;
}

function extId(ids: S2ExternalIds | null | undefined): PaperRef | null {
  return typedCore().citationExternalIdRef(ids ?? null) as PaperRef | null;
}

function s2Id(ref: PaperRef): string {
  // Bibliographic refs have no Semantic Scholar id, and the wasm PaperRefKind omits them.
  if (ref.kind === "bibliographic") throw new Error("Semantic Scholar needs an arXiv id, DOI, URL or Zotero key");
  return typedCore().s2PaperId(ref);
}

const BATCH_LIMIT = 500; // max ids per /paper/batch request

/** Paging stop rule (page cap, offset ceiling, non-advancing next) lives in Rust. */
function nextPageOffset(currentOffset: number, next: unknown, pagesFetched: number): number {
  return typedCore().nextCitationPageOffset(currentOffset, next, pagesFetched);
}

export class SemanticScholarCitationSource implements ICitationSource {
  readonly id = "semantic-scholar";

  constructor(
    // Wrap so `fetch` keeps its global `this` binding (a bare reference throws
    // "Illegal invocation" in the browser when called as a method).
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    // Resolved per call: the desktop shell relays the API (see `semanticScholarUrl`).
    private readonly baseUrl?: string,
    // Optional S2 API key (from user settings); raises the rate limit and is
    // sent only from the unlocked browser directly to Semantic Scholar.
    private readonly apiKey: () => Promise<string | undefined> = async () => undefined,
  ) {}

  supports(ref: PaperRef): boolean {
    return ref.kind === "arxiv" || ref.kind === "doi";
  }

  private base(): string {
    return this.baseUrl ?? semanticScholarUrl("graph/v1");
  }

  async references(ref: PaperRef): Promise<PaperRef[]> {
    const key = await this.apiKey();
    const init = key ? { headers: { "x-api-key": key } } : undefined;
    const refs: PaperRef[] = [];
    let offset = 0;
    let pages = 0;

    do {
      const url =
        `${this.base()}/paper/${encodeURIComponent(s2Id(ref))}/references` +
        `?fields=externalIds&limit=1000&offset=${offset}`;
      // S2 is aggressively rate-limited (~1 req/s); retry 429s with backoff
      // before giving up, so batch auto-linking doesn't fail on a transient cap.
      const res = await fetchSemanticScholar(this.fetchFn, url, init);
      if (!res.ok) {
        throw new Error(
          `Semantic Scholar request failed: ${res.status} ${res.statusText}`,
        );
      }
      const body = (await res.json()) as S2ReferencesResponse & { next?: number };
      for (const item of body.data ?? []) {
        const ref = extId(item.citedPaper?.externalIds);
        if (ref) refs.push(ref);
      }
      pages += 1;
      const next = body.next;
      offset = nextPageOffset(offset, next, pages);
    } while (offset >= 0);

    return refs;
  }

  /** Incoming citations, paged so alert baselines do not miss older papers. */
  async citations(ref: PaperRef): Promise<CitationCandidate[]> {
    const key = await this.apiKey();
    const init = key ? { headers: { "x-api-key": key } } : undefined;
    const out: CitationCandidate[] = [];
    let offset = 0;
    let pages = 0;

    do {
      const url =
        `${this.base()}/paper/${encodeURIComponent(s2Id(ref))}/citations` +
        `?fields=paperId,title,authors,year,url,citationCount,contexts,intents,isInfluential&limit=1000&offset=${offset}`;
      const res = await fetchSemanticScholar(this.fetchFn, url, init);
      if (!res.ok) {
        throw new Error(`Semantic Scholar citations failed: ${res.status} ${res.statusText}`);
      }
      const body = (await res.json()) as S2CitationsResponse;
      for (const item of body.data ?? []) {
        const paper = item.citingPaper;
        if (!paper) continue;
        const title = paper.title?.trim();
        const paperId = paper.paperId?.trim();
        if (!paperId || !title) continue;
        const contexts = mapContexts(item.contexts);
        const intents = mapIntents(item.intents);
        const isInfluential = mapIsInfluential(item.isInfluential);
        out.push({
          id: paperId,
          title,
          authors: (paper.authors ?? [])
            .map((author) => author.name?.trim())
            .filter((name): name is string => Boolean(name)),
          year: paper.year ?? undefined,
          url: paper.url ?? `https://www.semanticscholar.org/paper/${paperId}`,
          citationCount:
            typeof paper.citationCount === "number" && Number.isFinite(paper.citationCount)
              ? Math.max(0, Math.trunc(paper.citationCount))
              : undefined,
          ...(contexts ? { contexts } : {}),
          ...(intents ? { intents } : {}),
          ...(isInfluential !== undefined ? { isInfluential } : {}),
        });
      }
      pages += 1;
      // Soft-stop on stuck/zero next, page cap, or S2's offset≥10000 ceiling.
      offset = nextPageOffset(offset, body.next, pages);
    } while (offset >= 0);

    return out;
  }

  /**
   * Batch variant: one POST to `/paper/batch` returns every paper's references,
   * replacing N rate-limited GETs. Chunked at 500 ids; same 429 backoff.
   * Note: batch nests up to ~the first references per paper (S2 default), which
   * is plenty for matching against a personal library.
   */
  async referencesBatch(refs: PaperRef[]): Promise<(PaperRef[] | null)[]> {
    if (refs.length === 0) return [];
    const key = await this.apiKey();
    const out: (PaperRef[] | null)[] = [];

    for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
      const chunk = refs.slice(i, i + BATCH_LIMIT);
      const init: RequestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { "x-api-key": key } : {}),
        },
        body: JSON.stringify({ ids: chunk.map(s2Id) }),
      };
      const url = `${this.base()}/paper/batch?fields=references.externalIds`;
      const res = await fetchSemanticScholar(this.fetchFn, url, init);
      if (!res.ok) {
        throw new Error(`Semantic Scholar batch failed: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as (S2BatchItem | null)[];
      // S2 returns one entry per input id, in order. If that contract breaks,
      // fail loudly rather than silently misalign refs to the wrong papers.
      if (!Array.isArray(data) || data.length !== chunk.length) {
        throw new Error(
          `Semantic Scholar batch returned ${Array.isArray(data) ? data.length : "?"} items for ${chunk.length} ids.`,
        );
      }
      for (const item of data) {
        if (!item || !item.references) {
          out.push(null);
          continue;
        }
        const list: PaperRef[] = [];
        for (const r of item.references) {
          const ref = extId(r.externalIds);
          if (ref) list.push(ref);
        }
        out.push(list);
      }
    }
    return out;
  }
}
