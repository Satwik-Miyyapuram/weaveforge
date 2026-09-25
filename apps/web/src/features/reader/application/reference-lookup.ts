import { type PaperMetadata, type PaperRef, type PaperIdentity } from "@weaveforge/core";
import type { IPaperIdentityLookup, ParsedReference } from "@weaveforge/core";

/**
 * What the panel shows when a cited paper is already in the library.
 *
 * `PaperIdentity`, not `Paper`: the popover and the panel read the *status* (so
 * they can say "in library · read") and the id, and nothing else. Typing it as a
 * full paper was a promise the lookup paid for in columns — a bibliography walk
 * transferred the abstract, the bibtex and the metadata bag of every reference it
 * recognised. A `Paper` still satisfies this, so the places that build a
 * resolution from a freshly added paper are unaffected.
 */
export type ResolvedReference =
  | { status: "resolved"; metadata: PaperMetadata; inLibrary?: PaperIdentity; sourceId: string }
  | { status: "unresolved" }
  | { status: "pending" };

export interface ReferenceLookupCache {
  get(key: string): Promise<ResolvedReference | undefined> | ResolvedReference | undefined;
  set(key: string, value: ResolvedReference): Promise<void> | void;
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_SCHEMA = 4;

function cacheKey(documentKey: string, refIndex: number): string {
  return `v${CACHE_SCHEMA}:${documentKey}:ref:${refIndex}`;
}

/**
 * Resolves parsed bibliography entries to metadata. The entry is offered to
 * the resolver in the order the identifiers trust: DOI first, then arXiv id,
 * then a title (+authors, year) search — and each form falls through to the
 * next when it fails, so an entry whose DOI the providers do not know still
 * resolves by its title. With the reader's resolver, Semantic Scholar is the
 * first provider for all three forms, with OpenAlex/Crossref behind it.
 * Results are cached per (documentKey, refIndex) with a 30-day TTL and
 * lazily stamped with time. The document key is the text layer's fingerprint
 * rather than the paper id, so two copies of one paper — or a re-upload —
 * share one set of lookups.
 */
export class ReferenceLookupService {
  private readonly memory = new Map<string, { at: number; value: ResolvedReference }>();

  constructor(
    private readonly resolver: { resolveWithSource(ref: PaperRef): Promise<{ metadata: PaperMetadata; sourceId: string }> },
    /** The identity of a paper the library already has; see `IPaperIdentityLookup`. */
    private readonly papers: IPaperIdentityLookup,
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
    // Every shape the entry can be asked for, strongest identifier first; a
    // form that fails (unknown DOI, no search match) hands over to the next.
    const attempts: PaperRef[] = [];
    if (ref.doi) attempts.push({ kind: "doi", value: ref.doi });
    if (ref.arxivId) attempts.push({ kind: "arxiv", value: ref.arxivId });
    if (ref.title) {
      attempts.push({
        kind: "bibliographic",
        value: ref.title,
        hints: {
          title: ref.title,
          ...(ref.year != null ? { year: ref.year } : {}),
          ...(ref.authors[0] ? { firstAuthor: ref.authors[0] } : {}),
        },
      });
    }
    for (const attempt of attempts) {
      try {
        const { metadata, sourceId } = await this.resolver.resolveWithSource(attempt);
        return { status: "resolved", metadata, inLibrary: await this.findInLibrary(metadata), sourceId };
      } catch {
        /* try the next form of the same entry */
      }
    }
    return { status: "unresolved" };
  }

  private async findInLibrary(metadata: PaperMetadata): Promise<PaperIdentity | undefined> {
    return (metadata.doi
      ? await this.papers.findIdentityByDoi(metadata.doi)
      : metadata.arxivId
        ? await this.papers.findIdentityByArxivId(metadata.arxivId)
        : null) ?? undefined;
  }
}
