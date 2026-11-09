import { paperInputWithoutNulls, type IMetadataSource, type PaperMetadata, type PaperRef } from "@weaveforge/core";
import type { CrossrefMessage } from "@weaveforge/wasm";
import { loadCore, readyCore } from "@/lib/rust-core";

/**
 * Crossref metadata source (DOI). Implements IMetadataSource so it registers
 * with the MetadataResolver alongside arXiv without changing the resolver or
 * the import use-case (Open/Closed). Dependency-free (fetch + JSON).
 */

export class CrossrefMetadataSource implements IMetadataSource {
  readonly id = "crossref";

  constructor(
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly baseUrl = "https://api.crossref.org/works",
  ) {}

  supports(ref: PaperRef): boolean {
    return ref.kind === "doi";
  }

  async fetch(ref: PaperRef): Promise<PaperMetadata> {
    // Accept full URLs / "doi:" forms by normalizing to the bare DOI first.
    // `extractDoi` also pulls one out of a publisher URL (dl.acm.org/doi/10.x).
    const doi = (await loadCore()).extractDoi(ref.value) ?? readyCore().normalizeDoi(ref.value) ?? ref.value.trim();
    const res = await this.fetchFn(`${this.baseUrl}/${encodeURIComponent(doi)}`);
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`DOI not found in Crossref: ${doi}`);
      }
      throw new Error(`Crossref request failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { message?: CrossrefMessage };
    return paperInputWithoutNulls(readyCore().crossrefToMetadata(body.message ?? {}, doi));
  }
}
