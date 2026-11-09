import { type IMetadataSource, type PaperMetadata, type PaperRef } from "@weaveforge/core";
import type { OpenAlexWork } from "@weaveforge/wasm";
import { loadCore } from "@/lib/rust-core";

export class OpenAlexMetadataSource implements IMetadataSource {
  readonly id = "openalex";
  constructor(
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly baseUrl = "https://api.openalex.org/works",
    private readonly mailto?: string,
    /** The user's OpenAlex key, read per call: it is only decryptable after unlock. */
    private readonly apiKey?: () => Promise<string | undefined>,
  ) {}

  supports(ref: PaperRef): boolean { return ref.kind === "bibliographic"; }

  async fetch(ref: PaperRef): Promise<PaperMetadata> {
    if (ref.kind !== "bibliographic") throw new Error("Expected a bibliographic reference");
    const params = new URLSearchParams({ search: ref.hints?.title ?? ref.value, "per-page": "3" });
    if (this.mailto) params.set("mailto", this.mailto);
    const key = await this.apiKey?.();
    if (key) params.set("api_key", key);
    const response = await this.fetchFn(`${this.baseUrl}?${params}`);
    if (!response.ok) throw new Error(`OpenAlex metadata failed: ${response.status}`);
    const body = await response.json() as { results?: OpenAlexWork[] };
    const core = await loadCore();
    for (const work of body.results ?? []) {
      if (!work.title || !core.isBibliographicMatch(ref.hints ?? {}, { title: work.title, year: work.publication_year ?? undefined })) continue;
      return core.openAlexToMetadata(work);
    }
    throw new Error("No sufficiently similar OpenAlex match");
  }
}
