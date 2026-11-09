import { type IMetadataSource, type PaperMetadata, type PaperRef } from "@weaveforge/core";
import { loadCore } from "@/lib/rust-core";

/**
 * arXiv metadata source. Implements the IMetadataSource contract so it can be
 * registered with the MetadataResolver without changing the resolver or the
 * import use-case (Open/Closed).
 *
 * Uses the public arXiv Atom API. The feed is parsed in Rust (`arxivEntryToMetadata`).
 */
export class ArxivMetadataSource implements IMetadataSource {
  readonly id = "arxiv";

  constructor(
    // Wrap so `fetch` keeps its global `this` binding (a bare reference throws
    // "Illegal invocation" in the browser when called as a method).
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly baseUrl = "https://export.arxiv.org/api/query",
  ) {}

  supports(ref: PaperRef): boolean {
    return ref.kind === "arxiv";
  }

  async fetch(ref: PaperRef): Promise<PaperMetadata> {
    // Accept an abs/pdf URL or an `arXiv:` prefixed string, not just a bare id.
    const core = await loadCore();
    const id = core.normalizeArxivId(ref.value) ?? ref.value.trim();
    const res = await this.fetchFn(`${this.baseUrl}?id_list=${encodeURIComponent(id)}`);
    if (!res.ok) {
      throw new Error(`arXiv request failed: ${res.status} ${res.statusText}`);
    }
    const xml = await res.text();
    return core.arxivEntryToMetadata(xml, id);
  }
}
