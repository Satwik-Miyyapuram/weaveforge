/**
 * Fetch related / recommended papers from Semantic Scholar for a seed library paper.
 * Filters out items already in the local library (by DOI / arXiv / title).
 */
import { normalizeDoi, normalizeTitleKey, type PaperSummary } from "@weaveforge/core";
import { fetchSemanticScholar, semanticScholarUrl } from "@/lib/semantic-scholar-fetch";

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
  const doi = normalizeDoi(hit.doi);
  if (doi) return `https://doi.org/${doi}`;
  if (hit.arxivId?.trim()) return `https://arxiv.org/abs/${hit.arxivId.trim()}`;
  return undefined;
}

function s2ToHit(p: S2Paper): RelatedPaperHit | null {
  const title = p.title?.trim();
  if (!title) return null;
  const doi = p.externalIds?.DOI ? normalizeDoi(p.externalIds.DOI) : undefined;
  const arxivId = p.externalIds?.ArXiv?.trim() || undefined;
  const citationCount =
    typeof p.citationCount === "number" && Number.isFinite(p.citationCount)
      ? Math.max(0, Math.trunc(p.citationCount))
      : undefined;
  return {
    title,
    authors: (p.authors ?? []).map((a) => a.name?.trim()).filter((n): n is string => Boolean(n)),
    year: p.year,
    doi: doi || undefined,
    arxivId,
    url: resolveRelatedPaperUrl({ url: p.url, doi: doi || undefined, arxivId }),
    abstract: p.abstract?.trim() || undefined,
    citationCount,
  };
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
    const doi = normalizeDoi(p.doi);
    if (doi) dois.add(doi);
    if (p.arxivId) arxivs.add(p.arxivId.toLowerCase());
    titles.add(normalizeTitleKey(p.title));
  }
  return { dois, arxivs, titles };
}

function isLocal(hit: RelatedPaperHit, keys: ReturnType<typeof localKeys>): boolean {
  const doi = normalizeDoi(hit.doi);
  if (doi && keys.dois.has(doi)) return true;
  if (hit.arxivId && keys.arxivs.has(hit.arxivId.toLowerCase())) return true;
  if (keys.titles.has(normalizeTitleKey(hit.title))) return true;
  return false;
}

const S2_FIELDS = "title,authors,year,externalIds,url,abstract,citationCount";

/**
 * Prefer S2 recommendations; fall back to citation neighbors with titles.
 *
 * Both the seed and the library are typed on the summary projection: this only
 * reads a paper's identifiers and title, all of which it carries. A full `Paper`
 * satisfies these types as well, so no existing caller changes.
 */
export async function fetchRelatedPapers(
  seed: PaperSummary,
  library: readonly PaperSummary[],
  opts?: { apiKey?: string; limit?: number },
): Promise<RelatedPaperHit[]> {
  const limit = opts?.limit ?? 8;
  const keys = localKeys(library);
  const apiKey = opts?.apiKey;

  const paperId =
    (seed.arxivId && `ARXIV:${seed.arxivId}`) ||
    (seed.doi && `DOI:${normalizeDoi(seed.doi)}`) ||
    null;
  if (!paperId) {
    throw new Error("Add a DOI or arXiv id to this paper before finding related work.");
  }

  const recUrl =
    semanticScholarUrl("recommendations/v1/papers/forpaper/") +
    `${encodeURIComponent(paperId)}?fields=${S2_FIELDS}&limit=${limit + 5}`;
  const recRes = await fetchSemanticScholar(fetch, recUrl, apiKey ? { headers: { "x-api-key": apiKey } } : undefined);
  const out: RelatedPaperHit[] = [];

  if (recRes.ok) {
    const body = (await recRes.json()) as { recommendedPapers?: S2Paper[] };
    for (const p of body.recommendedPapers ?? []) {
      const hit = s2ToHit(p);
      if (!hit || isLocal(hit, keys)) continue;
      out.push(hit);
      if (out.length >= limit) return out;
    }
  }

  // Fallback: references with richer fields
  const refUrl =
    semanticScholarUrl(`graph/v1/paper/${encodeURIComponent(paperId)}/references`) +
    `?fields=citedPaper.title,citedPaper.authors,citedPaper.year,citedPaper.externalIds,citedPaper.url,citedPaper.abstract,citedPaper.citationCount&limit=50`;
  const refRes = await fetchSemanticScholar(fetch, refUrl, apiKey ? { headers: { "x-api-key": apiKey } } : undefined);
  if (!refRes.ok && out.length === 0) {
    throw new Error(`Semantic Scholar request failed: ${refRes.status}`);
  }
  if (refRes.ok) {
    const body = (await refRes.json()) as {
      data?: { citedPaper?: S2Paper | null }[];
    };
    for (const row of body.data ?? []) {
      const hit = s2ToHit(row.citedPaper ?? {});
      if (!hit || isLocal(hit, keys)) continue;
      out.push(hit);
      if (out.length >= limit) break;
    }
  }

  return out;
}
