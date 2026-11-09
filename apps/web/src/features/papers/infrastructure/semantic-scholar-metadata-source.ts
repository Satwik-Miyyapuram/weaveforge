import { type IMetadataSource, type PaperMetadata, type PaperRef } from "@weaveforge/core";
import type { SemanticScholarPaper } from "@weaveforge/wasm";
import { fetchSemanticScholar, semanticScholarUrl } from "@/lib/semantic-scholar-fetch";
import { loadCore } from "@/lib/rust-core";

const FIELDS = "title,authors,year,venue,externalIds,openAccessPdf,citationCount";

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
    const params = new URLSearchParams({ query, fields: FIELDS });
    const key = await this.apiKey();
    const response = await fetchSemanticScholar(this.fetchFn, `${this.baseUrl ?? semanticScholarUrl("graph/v1")}/paper/search/match?${params}`, key ? { headers: { "x-api-key": key } } : undefined);
    if (!response.ok) throw new Error(`Semantic Scholar metadata failed: ${response.status}`);
    const body = await response.json() as { data?: SemanticScholarPaper[] };
    const core = await loadCore();
    for (const paper of body.data ?? []) {
      if (!paper.title || !core.isBibliographicMatch(ref.hints ?? {}, { title: paper.title, year: paper.year ?? undefined })) continue;
      return core.semanticScholarToMetadata(paper);
    }
    throw new Error("No sufficiently similar Semantic Scholar match");
  }

  /** `paper/DOI:10.…` / `paper/arXiv:2305.12345` — a certain lookup, not a search. */
  private async fetchByIdentifier(kind: "DOI" | "arXiv", value: string): Promise<PaperMetadata> {
    const key = await this.apiKey();
    const url = `${this.baseUrl ?? semanticScholarUrl("graph/v1")}/paper/${kind}:${encodeURIComponent(value)}?fields=${FIELDS}`;
    const response = await fetchSemanticScholar(this.fetchFn, url, key ? { headers: { "x-api-key": key } } : undefined);
    if (!response.ok) throw new Error(`Semantic Scholar ${kind} lookup failed: ${response.status}`);
    const paper = await response.json() as SemanticScholarPaper;
    if (!paper.title) throw new Error(`Semantic Scholar ${kind} lookup returned no paper`);
    const core = await loadCore();
    return core.semanticScholarToMetadata(paper);
  }
}
