import { isBibliographicMatch, normalizeDoi, type IMetadataSource, type PaperMetadata, type PaperRef } from "@weaveforge/core";

interface OpenAlexWork {
  id?: string;
  title?: string;
  doi?: string | null;
  publication_year?: number;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string }; pdf_url?: string | null };
  best_oa_location?: { pdf_url?: string | null } | null;
  cited_by_count?: number;
}

export class OpenAlexMetadataSource implements IMetadataSource {
  readonly id = "openalex";
  constructor(
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly baseUrl = "https://api.openalex.org/works",
    private readonly mailto?: string,
  ) {}

  supports(ref: PaperRef): boolean { return ref.kind === "bibliographic"; }

  async fetch(ref: PaperRef): Promise<PaperMetadata> {
    if (ref.kind !== "bibliographic") throw new Error("Expected a bibliographic reference");
    const params = new URLSearchParams({ search: ref.hints?.title ?? ref.value, "per-page": "3" });
    if (this.mailto) params.set("mailto", this.mailto);
    const response = await this.fetchFn(`${this.baseUrl}?${params}`);
    if (!response.ok) throw new Error(`OpenAlex metadata failed: ${response.status}`);
    const body = await response.json() as { results?: OpenAlexWork[] };
    for (const work of body.results ?? []) {
      if (!work.title || !isBibliographicMatch(ref.hints ?? {}, { title: work.title, year: work.publication_year })) continue;
      return {
        title: work.title,
        authors: (work.authorships ?? []).flatMap((entry) => entry.author?.display_name ? [entry.author.display_name] : []),
        year: work.publication_year,
        doi: normalizeDoi(work.doi ?? undefined),
        venue: work.primary_location?.source?.display_name,
        url: work.doi ?? work.id,
        metadata: { openAccessPdf: work.best_oa_location?.pdf_url ?? work.primary_location?.pdf_url, citationCount: work.cited_by_count },
      };
    }
    throw new Error("No sufficiently similar OpenAlex match");
  }
}
