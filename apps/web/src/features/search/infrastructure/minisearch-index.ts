import MiniSearch, { type Options, type SearchResult } from "minisearch";
import {
  effectiveFieldBoosts,
  kindMultiplier,
  buildExcerpt,
  isEmptyQuery,
  isFilterOnly,
  parseSearchQuery,
  processTerm,
  tokenize,
  MIN_PREFIX_LENGTH,
  SEARCH_FIELDS,
  documentBoost,
  fuzzinessForTerm,
  type IWorkspaceSearchIndex,
  type IWorkspaceSearchIndexFactory,
  type SearchDoc,
  type ParsedQuery,
  type SearchHit,
  type SearchSettings,
  type SearchKind,
  type SearchQueryOptions,
} from "@thesis/core";

/**
 * BM25 index over the workspace snapshot. The only module that imports
 * MiniSearch — the ranking rules themselves live in `@thesis/core` so they stay
 * testable without a library and can later be exposed as user settings.
 */

/**
 * Bumped whenever the indexed shape or tuning changes. A persisted index from a
 * different schema is discarded rather than migrated: rebuilding costs a few
 * hundred milliseconds, whereas a subtly mismatched index returns wrong results
 * indefinitely with no visible symptom.
 */
export const SEARCH_SCHEMA_VERSION = 2;

interface PersistedIndex {
  schemaVersion: number;
  revision: string;
  index: string;
  /** Stored alongside so document boosts survive a reload. */
  docs: Record<string, StoredFields>;
}

type StoredFields = Pick<
  SearchDoc,
  "kind" | "entityId" | "title" | "href" | "updatedAt" | "degree" | "path" | "tags" | "body" | "page"
>;

function miniSearchOptions(): Options<SearchDoc> {
  return {
    idField: "id",
    fields: [...SEARCH_FIELDS],
    // `path`, `tags`, and `body` are stored so field filters and excerpting can
    // work against the same text the ranker saw.
    storeFields: ["kind", "entityId", "title", "href", "updatedAt", "degree", "path", "tags", "body", "page"],
    // Arrays would otherwise stringify with commas glued to terms.
    extractField: (doc, field) => {
      const value = (doc as unknown as Record<string, unknown>)[field];
      return Array.isArray(value) ? value.join(" ") : ((value as string) ?? "");
    },
    // Shared with the query side: a term tokenized one way at index time and
    // another at query time simply never matches.
    tokenize: (text) => tokenize(text),
    processTerm: (term) => processTerm(term),
  };
}

class MiniSearchWorkspaceIndex implements IWorkspaceSearchIndex {
  /** User ranking preferences; defaults apply when unset. */
  settings: SearchSettings | undefined;

  constructor(
    private readonly engine: MiniSearch<SearchDoc>,
    public revision: string,
    private readonly stored: Map<string, StoredFields>,
  ) {}

  replaceAll(docs: readonly SearchDoc[]): void {
    this.engine.removeAll();
    this.stored.clear();
    this.add(docs);
  }

  add(docs: readonly SearchDoc[]): void {
    for (const doc of docs) {
      // Re-adding an existing id throws in MiniSearch, so replace explicitly.
      if (this.stored.has(doc.id)) this.engine.discard(doc.id);
      this.stored.set(doc.id, {
        kind: doc.kind,
        entityId: doc.entityId,
        title: doc.title,
        href: doc.href,
        updatedAt: doc.updatedAt,
        degree: doc.degree,
        path: doc.path,
        tags: doc.tags,
        body: doc.body,
        page: doc.page,
      });
    }
    this.engine.addAll(docs as SearchDoc[]);
  }

  remove(ids: readonly string[]): void {
    for (const id of ids) {
      if (!this.stored.has(id)) continue;
      this.engine.discard(id);
      this.stored.delete(id);
    }
  }

  search(query: string, options: SearchQueryOptions = {}): readonly SearchHit[] {
    const parsed = parseSearchQuery(query);
    if (isEmptyQuery(parsed)) return [];

    const limit = Math.max(1, Math.min(options.limit ?? 30, 200));
    // Caller-supplied kinds and `kind:` in the query intersect — a screen
    // scoped to notes must not be widened by typing `kind:paper`.
    const callerKinds = options.kinds ? new Set(options.kinds) : null;
    const queryKinds = parsed.kinds.length ? new Set(parsed.kinds) : null;

    // A filter-only query ("kind:note", "tag:vae") has nothing to rank, so
    // enumerate the stored documents and apply the filters to all of them.
    if (isFilterOnly(parsed)) {
      return this.filterOnly(parsed, callerKinds, queryKinds, limit);
    }

    const results = this.engine.search(parsed.text, {
      boost: effectiveFieldBoosts(this.settings),
      prefix: (term) => (options.prefix === false ? false : term.length >= MIN_PREFIX_LENGTH),
      fuzzy: (term) =>
        typeof options.fuzzy === "number"
          ? options.fuzzy
          : options.fuzzy === false
            ? 0
            : fuzzinessForTerm(term),
      // Document-level signal: link degree first, recency only as a tiebreak.
      boostDocument: (id, _term, storedFields) => {
        const fields = (storedFields ?? this.stored.get(String(id))) as StoredFields | undefined;
        if (!fields) return 1;
        return documentBoost({ ...(fields as SearchDoc), degree: fields.degree ?? 0 }, {
          kindMultiplier: kindMultiplier(fields.kind, this.settings),
          recency: this.settings?.recencyBoost,
        });
      },
      filter: (result) =>
        this.matchesFilters(result as SearchResult & StoredFields, parsed, callerKinds, queryKinds),
    });

    return results.slice(0, limit).map((result) => {
      const fields = result as SearchResult & StoredFields;
      return {
        id: String(result.id),
        kind: fields.kind,
        entityId: fields.entityId,
        title: fields.title,
        href: fields.href,
        score: result.score,
        page: fields.page,
        terms: result.terms,
        excerpt: options.excerpts
          ? buildExcerpt(fields.body ?? "", result.terms, { maxChars: 200 })
          : undefined,
      };
    });
  }

  /**
   * Field filters plus exclusions. Exclusions are checked against the stored
   * text rather than the inverted index so `-"work in progress"` excludes on
   * the phrase, not on either word.
   */
  private matchesFilters(
    fields: StoredFields,
    parsed: ParsedQuery,
    callerKinds: Set<SearchKind> | null,
    queryKinds: Set<SearchKind> | null,
  ): boolean {
    if (callerKinds && !callerKinds.has(fields.kind)) return false;
    if (queryKinds && !queryKinds.has(fields.kind)) return false;

    const path = (fields.path ?? "").toLowerCase();
    if (parsed.paths.length && !parsed.paths.every((needle) => path.includes(needle))) return false;

    if (parsed.tags.length) {
      const tags = (Array.isArray(fields.tags) ? fields.tags : []).map((t) => t.toLowerCase());
      if (!parsed.tags.every((needle) => tags.includes(needle))) return false;
    }

    // Phrases and exclusions both need the raw text: the inverted index knows
    // terms, not adjacency, so `"message passing"` would otherwise match any
    // document containing both words anywhere.
    if (parsed.phrases.length || parsed.exclude.length) {
      const haystack = `${fields.title} ${path} ${fields.body ?? ""}`.toLowerCase();
      if (!parsed.phrases.every((phrase) => haystack.includes(phrase))) return false;
      if (parsed.exclude.some((needle) => haystack.includes(needle))) return false;
    }

    return true;
  }

  /** Enumerate stored documents for queries that carry filters but no terms. */
  private filterOnly(
    parsed: ParsedQuery,
    callerKinds: Set<SearchKind> | null,
    queryKinds: Set<SearchKind> | null,
    limit: number,
  ): readonly SearchHit[] {
    const hits: SearchHit[] = [];
    for (const [id, fields] of this.stored) {
      if (!this.matchesFilters(fields, parsed, callerKinds, queryKinds)) continue;
      hits.push({
        id,
        kind: fields.kind,
        entityId: fields.entityId,
        title: fields.title,
        href: fields.href,
        // No term scoring to report; order by the document signal alone.
        score: documentBoost({ ...(fields as SearchDoc), degree: fields.degree ?? 0 }, {
          kindMultiplier: kindMultiplier(fields.kind, this.settings),
          recency: this.settings?.recencyBoost,
        }),
        terms: [],
      });
      if (hits.length >= limit * 4) break;
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  serialize(): string {
    const payload: PersistedIndex = {
      schemaVersion: SEARCH_SCHEMA_VERSION,
      revision: this.revision,
      index: JSON.stringify(this.engine),
      docs: Object.fromEntries(this.stored),
    };
    return JSON.stringify(payload);
  }
}

export const miniSearchIndexFactory: IWorkspaceSearchIndexFactory = {
  create(docs: readonly SearchDoc[]): IWorkspaceSearchIndex {
    const engine = new MiniSearch<SearchDoc>(miniSearchOptions());
    const index = new MiniSearchWorkspaceIndex(engine, "", new Map());
    index.replaceAll(docs);
    return index;
  },

  /**
   * Rehydrate a cached index. Returns null — meaning "rebuild" — whenever the
   * payload cannot be trusted: wrong schema, stale corpus, or malformed JSON.
   * Failing closed here is the difference between a slow first query and a
   * search box that quietly serves deleted documents.
   */
  load(serialized: string, revision: string): IWorkspaceSearchIndex | null {
    try {
      const payload = JSON.parse(serialized) as PersistedIndex;
      if (payload.schemaVersion !== SEARCH_SCHEMA_VERSION) return null;
      if (payload.revision !== revision) return null;

      const engine = MiniSearch.loadJSON<SearchDoc>(payload.index, miniSearchOptions());
      const stored = new Map<string, StoredFields>(Object.entries(payload.docs ?? {}));
      return new MiniSearchWorkspaceIndex(engine, payload.revision, stored);
    } catch {
      return null;
    }
  },
};

/** Build an index and stamp it with the corpus revision. */
export function buildSearchIndex(
  docs: readonly SearchDoc[],
  revision: string,
  settings?: SearchSettings,
): IWorkspaceSearchIndex {
  const index = miniSearchIndexFactory.create(docs) as MiniSearchWorkspaceIndex;
  index.revision = revision;
  index.settings = settings;
  return index;
}

/** Apply new ranking preferences without rebuilding the index. */
export function applySearchSettings(index: IWorkspaceSearchIndex, settings?: SearchSettings): void {
  (index as MiniSearchWorkspaceIndex).settings = settings;
}
