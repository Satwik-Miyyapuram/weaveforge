import type { CitationCandidate, ICitationSource, PaperRef } from "@thesis/core";

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

const CITATION_INTENTS = new Set(["background", "method", "result"]);

function mapContexts(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const contexts = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return contexts.length > 0 ? contexts : undefined;
}

function mapIntents(raw: unknown): CitationCandidate["intents"] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const intents = raw.filter(
    (item): item is NonNullable<CitationCandidate["intents"]>[number] =>
      typeof item === "string" && CITATION_INTENTS.has(item),
  );
  return intents.length > 0 ? intents : undefined;
}

function mapIsInfluential(raw: unknown): boolean | undefined {
  return typeof raw === "boolean" ? raw : undefined;
}

function extId(ids: S2ExternalIds | null | undefined): PaperRef | null {
  if (!ids) return null;
  if (ids.ArXiv) return { kind: "arxiv", value: ids.ArXiv };
  if (ids.DOI) return { kind: "doi", value: ids.DOI };
  return null;
}

function s2Id(ref: PaperRef): string {
  return ref.kind === "arxiv" ? `ARXIV:${ref.value}` : `DOI:${ref.value}`;
}

const BATCH_LIMIT = 500; // max ids per /paper/batch request

export class SemanticScholarCitationSource implements ICitationSource {
  readonly id = "semantic-scholar";

  constructor(
    // Wrap so `fetch` keeps its global `this` binding (a bare reference throws
    // "Illegal invocation" in the browser when called as a method).
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly baseUrl = "https://api.semanticscholar.org/graph/v1",
    // Optional S2 API key (from user settings); raises the rate limit and is
    // sent only from the unlocked browser directly to Semantic Scholar.
    private readonly apiKey: () => Promise<string | undefined> = async () => undefined,
  ) {}

  supports(ref: PaperRef): boolean {
    return ref.kind === "arxiv" || ref.kind === "doi";
  }

  async references(ref: PaperRef): Promise<PaperRef[]> {
    const id = ref.kind === "arxiv" ? `ARXIV:${ref.value}` : `DOI:${ref.value}`;
    const url =
      `${this.baseUrl}/paper/${encodeURIComponent(id)}/references` +
      `?fields=externalIds&limit=1000`;
    const key = await this.apiKey();
    const init = key ? { headers: { "x-api-key": key } } : undefined;
    // S2 is aggressively rate-limited (~1 req/s); retry 429s with backoff
    // before giving up, so batch auto-linking doesn't fail on a transient cap.
    let res = await this.fetchFn(url, init);
    for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
      await delay(1000 * (attempt + 1));
      res = await this.fetchFn(url, init);
    }
    if (!res.ok) {
      throw new Error(
        `Semantic Scholar request failed: ${res.status} ${res.statusText}`,
      );
    }
    const body = (await res.json()) as S2ReferencesResponse;
    const refs: PaperRef[] = [];
    for (const item of body.data ?? []) {
      const ids = item.citedPaper?.externalIds;
      if (!ids) continue;
      if (ids.ArXiv) refs.push({ kind: "arxiv", value: ids.ArXiv });
      else if (ids.DOI) refs.push({ kind: "doi", value: ids.DOI });
    }
    return refs;
  }

  /** Incoming citations, paged so alert baselines do not miss older papers. */
  async citations(ref: PaperRef): Promise<CitationCandidate[]> {
    const key = await this.apiKey();
    const init = key ? { headers: { "x-api-key": key } } : undefined;
    const out: CitationCandidate[] = [];
    let offset = 0;

    do {
      const url =
        `${this.baseUrl}/paper/${encodeURIComponent(s2Id(ref))}/citations` +
        `?fields=paperId,title,authors,year,url,citationCount,contexts,intents,isInfluential&limit=1000&offset=${offset}`;
      let res = await this.fetchFn(url, init);
      for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
        await delay(1000 * (attempt + 1));
        res = await this.fetchFn(url, init);
      }
      if (!res.ok) {
        throw new Error(`Semantic Scholar citations failed: ${res.status} ${res.statusText}`);
      }
      const body = (await res.json()) as S2CitationsResponse;
      for (const item of body.data ?? []) {
        const paper = item.citingPaper;
        if (!paper?.paperId || !paper.title) continue;
        const contexts = mapContexts(item.contexts);
        const intents = mapIntents(item.intents);
        const isInfluential = mapIsInfluential(item.isInfluential);
        out.push({
          id: paper.paperId,
          title: paper.title,
          authors: (paper.authors ?? [])
            .map((author) => author.name?.trim())
            .filter((name): name is string => Boolean(name)),
          year: paper.year ?? undefined,
          url: paper.url ?? `https://www.semanticscholar.org/paper/${paper.paperId}`,
          citationCount:
            typeof paper.citationCount === "number" && Number.isFinite(paper.citationCount)
              ? Math.max(0, Math.trunc(paper.citationCount))
              : undefined,
          ...(contexts ? { contexts } : {}),
          ...(intents ? { intents } : {}),
          ...(isInfluential !== undefined ? { isInfluential } : {}),
        });
      }
      offset = typeof body.next === "number" ? body.next : -1;
      // S2 caps offset near 9999; stop explicitly so callers treat this as a
      // possibly truncated set and union into seen ids rather than replacing.
    } while (offset >= 0 && offset < 10_000);

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
      const url = `${this.baseUrl}/paper/batch?fields=references.externalIds`;
      let res = await this.fetchFn(url, init);
      for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
        await delay(1000 * (attempt + 1));
        res = await this.fetchFn(url, init);
      }
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
