import { type PaperMetadata, type PaperRef, type Paper } from "@weaveforge/core";
import type { ParsedReference } from "@weaveforge/core";

export type ResolvedReference =
  | { status: "resolved"; metadata: PaperMetadata; inLibrary?: Paper; sourceId: string }
  | { status: "unresolved" }
  | { status: "pending" };

export interface ReferenceLookupCache {
  get(key: string): Promise<ResolvedReference | undefined> | ResolvedReference | undefined;
  set(key: string, value: ResolvedReference): Promise<void> | void;
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_SCHEMA = 2;

function cacheKey(paperId: string, refIndex: number): string {
  return `v${CACHE_SCHEMA}:${paperId}:ref:${refIndex}`;
}

/**
 * Resolves parsed bibliography entries to metadata. Identifier lookups
 * (DOI/arXiv) go straight to the resolver; author/title-only entries search
 * Semantic Scholar then OpenAlex through it. Results are cached per
 * (paperId, refIndex) with a 30-day TTL and lazily stamped with time.
 */
export class ReferenceLookupService {
  private readonly memory = new Map<string, { at: number; value: ResolvedReference }>();

  constructor(
    private readonly resolver: { resolveWithSource(ref: PaperRef): Promise<{ metadata: PaperMetadata; sourceId: string }> },
    private readonly papers: { findByDoi(doi: string): Promise<Paper | null>; findByArxivId(id: string): Promise<Paper | null> },
    private readonly cache?: ReferenceLookupCache,
    private readonly now: () => number = () => Date.now(),
  ) {}

  resolve(paperId: string, ref: ParsedReference): Promise<ResolvedReference> {
    const key = cacheKey(paperId, ref.index);
    const hit = this.memory.get(key);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value);
    return (async () => {
      const cached = await this.cache?.get(key);
      if (cached) {
        this.memory.set(key, { at: this.now(), value: cached });
        return cached;
      }
      const value = await this.lookup(ref);
      this.memory.set(key, { at: this.now(), value });
      void this.cache?.set(key, value);
      return value;
    })();
  }

  private async lookup(ref: ParsedReference): Promise<ResolvedReference> {
    if (!ref.doi && !ref.arxivId && !ref.title) return { status: "unresolved" };
    try {
      const { metadata, sourceId } = await this.resolver.resolveWithSource(
        ref.doi
          ? { kind: "doi", value: ref.doi }
          : ref.arxivId
            ? { kind: "arxiv", value: ref.arxivId }
            : { kind: "bibliographic", value: ref.title!, hints: { title: ref.title!, year: ref.year, firstAuthor: ref.authors[0] } },
      );
      const inLibrary = (metadata.doi
        ? await this.papers.findByDoi(metadata.doi)
        : metadata.arxivId
          ? await this.papers.findByArxivId(metadata.arxivId)
          : null) ?? undefined;
      return { status: "resolved", metadata, inLibrary, sourceId };
    } catch {
      return { status: "unresolved" };
    }
  }
}
