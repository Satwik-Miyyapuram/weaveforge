/**
 * Fetch related or citing papers for a seed library paper: Semantic Scholar
 * first, OpenAlex when it has none.
 * Filters out items already in the local library (by DOI / arXiv / title).
 */
import { type PaperSummary } from "@weaveforge/core";
import { fetchSemanticScholar, semanticScholarUrl } from "@/lib/semantic-scholar-fetch";
import { readyCore } from "@/lib/rust-core";

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
  if (hit.url?.trim()) return hit.url.trim();
  const doi = readyCore().normalizeDoi(hit.doi);
  if (doi) return `https://doi.org/${doi}`;
  if (hit.arxivId?.trim()) return `https://arxiv.org/abs/${hit.arxivId.trim()}`;
  return undefined;
}

function s2ToHit(p: S2Paper): RelatedPaperHit | null {
  const title = p.title?.trim();
  if (!title) return null;
  const doi = p.externalIds?.DOI ? readyCore().normalizeDoi(p.externalIds.DOI) : undefined;
  const arxivId = p.externalIds?.ArXiv?.trim() || undefined;
  return {
    title,
    authors: (p.authors ?? []).map((a) => a.name?.trim()).filter((n): n is string => Boolean(n)),
    year: p.year,
    doi: doi || undefined,
    arxivId,
    url: resolveRelatedPaperUrl({ url: p.url, doi: doi || undefined, arxivId }),
    abstract: p.abstract?.trim() || undefined,
    citationCount: toCount(p.citationCount),
  };
}

function toCount(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : undefined;
}

/**
 * The library rows a "is this already in my library?" check needs: DOI, arXiv
 * id and title. All three are on the summary projection, so the parameter is
 * typed on it — the library a screen passes in is a summary read, and asking
 * for a full `Paper` would be a demand the caller cannot meet without loading
 * the abstract and metadata bag for every row in the library.
 */
function localKeys(papers: readonly PaperSummary[]) {
  const dois = new Set<string>();
  const arxivs = new Set<string>();
  const titles = new Set<string>();
  for (const p of papers) {
    const doi = readyCore().normalizeDoi(p.doi);
    if (doi) dois.add(doi);
    if (p.arxivId) arxivs.add(p.arxivId.toLowerCase());
    titles.add(readyCore().normalizeTitleKey(p.title));
  }
  return { dois, arxivs, titles };
}

function isLocal(hit: RelatedPaperHit, keys: ReturnType<typeof localKeys>): boolean {
  const doi = readyCore().normalizeDoi(hit.doi);
  if (doi && keys.dois.has(doi)) return true;
  if (hit.arxivId && keys.arxivs.has(hit.arxivId.toLowerCase())) return true;
  if (keys.titles.has(readyCore().normalizeTitleKey(hit.title))) return true;
  return false;
}

/**
 * Note a listed hit, so the same paper from the other source (or twice from
 * one) is skipped like a library paper. The panel keys rows by these ids.
 */
function remember(hit: RelatedPaperHit, keys: ReturnType<typeof localKeys>): void {
  const doi = readyCore().normalizeDoi(hit.doi);
  if (doi) keys.dois.add(doi);
  if (hit.arxivId) keys.arxivs.add(hit.arxivId.toLowerCase());
  keys.titles.add(readyCore().normalizeTitleKey(hit.title));
}

const S2_FIELDS = "title,authors,year,externalIds,url,abstract,citationCount";

/** S2's fields, asked of the paper nested in a references or citations row. */
const nested = (key: string) => S2_FIELDS.split(",").map((f) => `${key}.${f}`).join(",");

/** Which neighbours to list: work like the seed, or the papers that cite it. */
export type RelatedKind = "related" | "citedBy";

/** Adds each new hit to `out` until it holds `limit`; the library and repeats are skipped. */
function collect(
  hits: readonly (RelatedPaperHit | null)[],
  keys: ReturnType<typeof localKeys>,
  out: RelatedPaperHit[],
  limit: number,
): void {
  for (const hit of hits) {
    if (out.length >= limit) return;
    if (!hit || isLocal(hit, keys)) continue;
    remember(hit, keys);
    out.push(hit);
  }
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
    `fields=${nested("citedPaper")}&limit=50`,
    apiKey,
  );
  return (body.data ?? []).map((row) => s2ToHit(row.citedPaper ?? {}));
}

/** The papers citing the seed, most cited first. */
async function s2Citing(paperId: string, apiKey?: string) {
  const body = await s2Json<{ data?: { citingPaper?: S2Paper | null }[] }>(
    `graph/v1/paper/${encodeURIComponent(paperId)}/citations`,
    `fields=${nested("citingPaper")}&limit=100`,
    apiKey,
  );
  return (body.data ?? [])
    .map((row) => s2ToHit(row.citingPaper ?? {}))
    .sort((a, b) => (b?.citationCount ?? 0) - (a?.citationCount ?? 0));
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

async function openAlexJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenAlex request failed: ${res.status}`);
  return (await res.json()) as T;
}

/** OpenAlex sends an abstract as word -> positions; this puts the words back in order. */
function invertedAbstract(index?: Record<string, number[]> | null): string | undefined {
  if (!index) return undefined;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const at of positions) words[at] = word;
  return words.filter(Boolean).join(" ") || undefined;
}

function openAlexToHit(w: OpenAlexWork): RelatedPaperHit | null {
  const title = w.title?.trim();
  if (!title) return null;
  const doi = readyCore().normalizeDoi(w.doi ?? undefined) || undefined;
  return {
    title,
    authors: (w.authorships ?? []).flatMap((a) => (a.author?.display_name?.trim() ? [a.author.display_name.trim()] : [])),
    year: w.publication_year,
    doi,
    arxivId: undefined,
    url: resolveRelatedPaperUrl({ doi }),
    abstract: invertedAbstract(w.abstract_inverted_index),
    citationCount: toCount(w.cited_by_count),
  };
}

/** The seed's DOI, or for an arXiv paper the arXiv DOI OpenAlex files it under. */
function seedDoi(seed: PaperSummary): string | undefined {
  const doi = readyCore().normalizeDoi(seed.doi);
  if (doi) return doi;
  const arxiv = seed.arxivId?.trim().replace(/v\d+$/i, "");
  return arxiv ? `10.48550/arXiv.${arxiv}` : undefined;
}

const workId = (url: string) => url.split("/").pop() ?? "";

/** The same neighbours from OpenAlex: its related works, or the works citing the seed. */
async function openAlexNeighbours(seed: PaperSummary, kind: RelatedKind, limit: number) {
  const doi = seedDoi(seed);
  if (!doi) return [];
  const work = await openAlexJson<OpenAlexWork>(
    `${OPENALEX}/doi:${encodeURIComponent(doi).replace(/%2F/gi, "/")}?select=id,related_works`,
  );
  const related = (work.related_works ?? []).map(workId).filter(Boolean);
  if (!work.id || (kind === "related" && related.length === 0)) return [];
  const params = new URLSearchParams({
    filter: kind === "citedBy" ? `cites:${workId(work.id)}` : `openalex_id:${related.join("|")}`,
    select: OPENALEX_SELECT,
    "per-page": String(limit + 5),
  });
  if (kind === "citedBy") params.set("sort", "cited_by_count:desc");
  const body = await openAlexJson<{ results?: OpenAlexWork[] }>(`${OPENALEX}?${params}`);
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
  opts?: { apiKey?: string; limit?: number; kind?: RelatedKind },
): Promise<RelatedPaperHit[]> {
  const limit = opts?.limit ?? 8;
  const kind = opts?.kind ?? "related";
  const apiKey = opts?.apiKey;
  const keys = localKeys(library);

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
  const out: RelatedPaperHit[] = [];
  let failure: unknown;
  for (const source of sources) {
    if (out.length >= limit) break;
    try {
      collect(await source(), keys, out, limit);
    } catch (err) {
      failure ??= err;
    }
  }
  if (out.length === 0) {
    try {
      collect(await openAlexNeighbours(seed, kind, limit), keys, out, limit);
    } catch {
      // Semantic Scholar's error, below, is the one worth showing.
    }
  }
  if (out.length === 0 && failure) throw failure;
  return out;
}
