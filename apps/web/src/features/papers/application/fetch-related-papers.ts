/**
 * Fetch related or citing papers for a seed library paper: Semantic Scholar
 * first, OpenAlex when it has none.
 * Filters out items already in the local library (by DOI / arXiv / title).
 */
import { type PaperSummary } from "@weaveforge/core";
import type { RelatedPaperKeys } from "@weaveforge/wasm";
import { fetchSemanticScholar, semanticScholarUrl } from "@/lib/semantic-scholar-fetch";
import { readyCore, typedCore } from "@/lib/rust-core";

export type RelatedPaperHit = {
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  url?: string;
  abstract?: string;
  /** Semantic Scholar (or derived) citation count when available. */
  citationCount?: number;
};

type S2Paper = {
  title?: string;
  year?: number;
  abstract?: string;
  url?: string;
  citationCount?: number;
  authors?: { name?: string }[];
  externalIds?: { DOI?: string; ArXiv?: string } | null;
};

export function resolveRelatedPaperUrl(hit: Pick<RelatedPaperHit, "url" | "doi" | "arxivId">): string | undefined {
  return typedCore().resolveRelatedPaperUrl(hit);
}

/**
 * Rust sends an absent field as null; the hit type and the old TS have it undefined, key kept.
 * Takes the Rust row as an object: its nullable fields (year, doi, ...) are what this rewrites.
 */
function undefinedForNull(hit: object | null): RelatedPaperHit | null {
  if (!hit) return hit;
  return Object.fromEntries(Object.entries(hit).map(([k, v]) => [k, v ?? undefined])) as RelatedPaperHit;
}

/** The hit for a Semantic Scholar paper; the field rules are in Rust (`related_paper_hit`). */
function s2ToHit(p: S2Paper): RelatedPaperHit | null {
  return undefinedForNull(typedCore().s2ToHit(p));
}

const S2_FIELDS = "title,authors,year,externalIds,url,abstract,citationCount";

/** Which neighbours to list: work like the seed, or the papers that cite it. */
export type RelatedKind = "related" | "citedBy";

/**
 * The dedupe state carried across the sources: the keys (library plus listed
 * hits) and the hits kept so far. The field rules and the dedupe are in Rust.
 */
type Collected = { keys: RelatedPaperKeys; hits: RelatedPaperHit[] };

/**
 * Adds each new candidate to the state until it holds `limit` hits; the library
 * and repeats are skipped. The library is typed on the summary projection: the
 * fields the dedupe reads are all on it.
 */
function collect(candidates: readonly unknown[], state: Collected, limit: number): Collected {
  const out = typedCore().collectNewHits({ keys: state.keys, hits: state.hits, candidates, limit });
  return { keys: out.keys, hits: out.hits.map((hit) => undefinedForNull(hit) as RelatedPaperHit) };
}

async function s2Json<T>(path: string, query: string, apiKey?: string): Promise<T> {
  const url = `${semanticScholarUrl(path)}?${query}`;
  const res = await fetchSemanticScholar(fetch, url, apiKey ? { headers: { "x-api-key": apiKey } } : undefined);
  if (!res.ok) throw new Error(`Semantic Scholar request failed: ${res.status}`);
  return (await res.json()) as T;
}

async function s2Recommended(paperId: string, limit: number, apiKey?: string) {
  const body = await s2Json<{ recommendedPapers?: S2Paper[] }>(
    `recommendations/v1/papers/forpaper/${encodeURIComponent(paperId)}`,
    `fields=${S2_FIELDS}&limit=${limit + 5}`,
    apiKey,
  );
  return (body.recommendedPapers ?? []).map(s2ToHit);
}

async function s2References(paperId: string, apiKey?: string) {
  const body = await s2Json<{ data?: { citedPaper?: S2Paper | null }[] }>(
    `graph/v1/paper/${encodeURIComponent(paperId)}/references`,
    `fields=${typedCore().s2NestedFields("citedPaper")}&limit=50`,
    apiKey,
  );
  return (body.data ?? []).map((row) => s2ToHit(row.citedPaper ?? {}));
}

/** The papers citing the seed, most cited first. */
async function s2Citing(paperId: string, apiKey?: string) {
  const body = await s2Json<{ data?: { citingPaper?: S2Paper | null }[] }>(
    `graph/v1/paper/${encodeURIComponent(paperId)}/citations`,
    `fields=${typedCore().s2NestedFields("citingPaper")}&limit=100`,
    apiKey,
  );
  return typedCore().sortByCitations(
    (body.data ?? []).map((row) => s2ToHit(row.citingPaper ?? {})),
  );
}

const OPENALEX = "https://api.openalex.org/works";
const OPENALEX_SELECT = "id,title,doi,publication_year,authorships,cited_by_count,abstract_inverted_index";

type OpenAlexWork = {
  id?: string;
  title?: string | null;
  doi?: string | null;
  publication_year?: number;
  authorships?: { author?: { display_name?: string } }[];
  cited_by_count?: number;
  abstract_inverted_index?: Record<string, number[]> | null;
  related_works?: string[];
};

/** Every OpenAlex URL here already has a query, so the key is appended to it. */
async function openAlexJson<T>(url: string, key?: string): Promise<T> {
  const res = await fetch(key ? `${url}&api_key=${encodeURIComponent(key)}` : url);
  if (!res.ok) throw new Error(`OpenAlex request failed: ${res.status}`);
  return (await res.json()) as T;
}

/** The hit for an OpenAlex work, its abstract rebuilt in Rust (`related_paper_hit`). */
function openAlexToHit(w: OpenAlexWork): RelatedPaperHit | null {
  return undefinedForNull(typedCore().openAlexToHit(w));
}

/** The seed's DOI, or for an arXiv paper the arXiv DOI OpenAlex files it under. */
function seedDoi(seed: PaperSummary): string | undefined {
  return typedCore().seedDoi(seed.doi, seed.arxivId);
}

const workId = (url: string) => url.split("/").pop() ?? "";

/** The same neighbours from OpenAlex: its related works, or the works citing the seed. */
async function openAlexNeighbours(seed: PaperSummary, kind: RelatedKind, limit: number, key?: string) {
  const doi = seedDoi(seed);
  if (!doi) return [];
  const work = await openAlexJson<OpenAlexWork>(
    `${OPENALEX}/doi:${encodeURIComponent(doi).replace(/%2F/gi, "/")}?select=id,related_works`,
    key,
  );
  const related = (work.related_works ?? []).map(workId).filter(Boolean);
  if (!work.id || (kind === "related" && related.length === 0)) return [];
  const params = new URLSearchParams({
    filter: kind === "citedBy" ? `cites:${workId(work.id)}` : `openalex_id:${related.join("|")}`,
    select: OPENALEX_SELECT,
    "per-page": String(limit + 5),
  });
  if (kind === "citedBy") params.set("sort", "cited_by_count:desc");
  const body = await openAlexJson<{ results?: OpenAlexWork[] }>(`${OPENALEX}?${params}`, key);
  return (body.results ?? []).map(openAlexToHit);
}

/**
 * Work like the seed (S2 recommendations, then its references) or the papers
 * citing it. When Semantic Scholar has nothing — throttled, or the paper is
 * unknown to it — OpenAlex is asked the same question.
 *
 * Both the seed and the library are typed on the summary projection: this only
 * reads a paper's identifiers and title, all of which it carries. A full `Paper`
 * satisfies these types as well, so no existing caller changes.
 */
export async function fetchRelatedPapers(
  seed: PaperSummary,
  library: readonly PaperSummary[],
  opts?: { apiKey?: string; openAlexKey?: string; limit?: number; kind?: RelatedKind },
): Promise<RelatedPaperHit[]> {
  const limit = opts?.limit ?? 8;
  const kind = opts?.kind ?? "related";
  const apiKey = opts?.apiKey;
  let state: Collected = { keys: typedCore().localKeys(library), hits: [] };

  const paperId =
    (seed.arxivId && `ARXIV:${seed.arxivId}`) ||
    (seed.doi && `DOI:${readyCore().normalizeDoi(seed.doi)}`) ||
    null;
  if (!paperId) {
    throw new Error("Add a DOI or arXiv id to this paper before finding related work.");
  }

  const sources =
    kind === "citedBy"
      ? [() => s2Citing(paperId, apiKey)]
      : [() => s2Recommended(paperId, limit, apiKey), () => s2References(paperId, apiKey)];
  let failure: unknown;
  for (const source of sources) {
    if (state.hits.length >= limit) break;
    try {
      state = collect(await source(), state, limit);
    } catch (err) {
      failure ??= err;
    }
  }
  if (state.hits.length === 0) {
    try {
      state = collect(await openAlexNeighbours(seed, kind, limit, opts?.openAlexKey), state, limit);
    } catch {
      // Semantic Scholar's error, below, is the one worth showing.
    }
  }
  if (state.hits.length === 0 && failure) throw failure;
  return state.hits;
}
