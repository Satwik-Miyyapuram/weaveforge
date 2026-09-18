import { isBibliographicMatch, normalizeDoi, normalizeArxivId, type IMetadataSource, type PaperMetadata, type PaperRef } from "@weaveforge/core";
import { fetchSemanticScholar, semanticScholarUrl } from "@/lib/semantic-scholar-fetch";

interface MatchPaper {
  title?: string;
  authors?: { name?: string }[];
  year?: number;
  venue?: string;
  paperId?: string;
  externalIds?: { DOI?: string; ArXiv?: string };
  openAccessPdf?: { url?: string } | null;
  citationCount?: number;
}

export class SemanticScholarMetadataSource implements IMetadataSource {
  readonly id = "semantic-scholar";

  constructor(
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    // Resolved per call: the desktop shell relays the API (see `semanticScholarUrl`).
    private readonly baseUrl?: string,
    private readonly apiKey: () => Promise<string | undefined> = async () => undefined,
  ) {}

  supports(ref: PaperRef): boolean { return ref.kind === "bibliographic"; }

  async fetch(ref: PaperRef): Promise<PaperMetadata> {
    if (ref.kind !== "bibliographic") throw new Error("Expected a bibliographic reference");
    const query = ref.hints?.title ?? ref.value;
    const params = new URLSearchParams({ query, fields: "title,authors,year,venue,externalIds,openAccessPdf,citationCount" });
    const key = await this.apiKey();
    const response = await fetchSemanticScholar(this.fetchFn, `${this.baseUrl ?? semanticScholarUrl("graph/v1")}/paper/search/match?${params}`, key ? { headers: { "x-api-key": key } } : undefined);
    if (!response.ok) throw new Error(`Semantic Scholar metadata failed: ${response.status}`);
    const body = await response.json() as { data?: MatchPaper[] };
    for (const paper of body.data ?? []) {
      if (!paper.title || !isBibliographicMatch(ref.hints ?? {}, { title: paper.title, year: paper.year })) continue;
      return {
        title: paper.title,
        authors: (paper.authors ?? []).flatMap((author) => author.name ? [author.name] : []),
        year: paper.year, venue: paper.venue,
        doi: normalizeDoi(paper.externalIds?.DOI),
        arxivId: normalizeArxivId(paper.externalIds?.ArXiv),
        url: paper.paperId ? `https://www.semanticscholar.org/paper/${encodeURIComponent(paper.paperId)}` : undefined,
        metadata: { openAccessPdf: paper.openAccessPdf?.url, citationCount: paper.citationCount },
      };
    }
    throw new Error("No sufficiently similar Semantic Scholar match");
  }
}
