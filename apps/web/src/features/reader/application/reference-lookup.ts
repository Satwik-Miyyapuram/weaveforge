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
const CACHE_SCHEMA = 3;

function cacheKey(documentKey: string, refIndex: number): string {
  return `v${CACHE_SCHEMA}:${documentKey}:ref:${refIndex}`;
}

/**
 * Resolves parsed bibliography entries to metadata. Identifier lookups
 * (DOI/arXiv) go straight to the resolver; author/title-only entries search
 * Semantic Scholar then OpenAlex through it. Results are cached per
 * (documentKey, refIndex) with a 30-day TTL and lazily stamped with time. The
 * document key is the text layer's fingerprint rather than the paper id, so
 * two copies of one paper — or a re-upload — share one set of lookups.
 */
export class ReferenceLookupService {
  private readonly memory = new Map<string, { at: number; value: ResolvedReference }>();

  constructor(
    private readonly resolver: { resolveWithSource(ref: PaperRef): Promise<{ metadata: PaperMetadata; sourceId: string }> },
    private readonly papers: { findByDoi(doi: string): Promise<Paper | null>; findByArxivId(id: string): Promise<Paper | null> },
    private readonly cache?: ReferenceLookupCache,
    private readonly now: () => number = () => Date.now(),
  ) {}

  resolve(documentKey: string, ref: ParsedReference): Promise<ResolvedReference> {
    const key = cacheKey(documentKey, ref.index);
    const hit = this.memory.get(key);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value);
    return (async () => {
      const cached = await this.cache?.get(key);
      if (cached) {
        // Whether the paper is in the library is a fact about this workspace,
        // not the reference, so it is re-read rather than trusted from disk.
        const value = cached.status === "resolved"
          ? { ...cached, inLibrary: await this.findInLibrary(cached.metadata) }
          : cached;
        this.memory.set(key, { at: this.now(), value });
        return value;
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
      return { status: "resolved", metadata, inLibrary: await this.findInLibrary(metadata), sourceId };
    } catch {
      return { status: "unresolved" };
    }
  }

  private async findInLibrary(metadata: PaperMetadata): Promise<Paper | undefined> {
    return (metadata.doi
      ? await this.papers.findByDoi(metadata.doi)
      : metadata.arxivId
        ? await this.papers.findByArxivId(metadata.arxivId)
        : null) ?? undefined;
  }
}
