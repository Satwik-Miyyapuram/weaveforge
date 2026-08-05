import MiniSearch, { type Options, type SearchResult } from "minisearch";
import {
  FIELD_BOOSTS,
  MIN_PREFIX_LENGTH,
  SEARCH_FIELDS,
  documentBoost,
  fuzzinessForTerm,
  type IWorkspaceSearchIndex,
  type IWorkspaceSearchIndexFactory,
  type SearchDoc,
  type SearchHit,
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
export const SEARCH_SCHEMA_VERSION = 1;

interface PersistedIndex {
  schemaVersion: number;
  revision: string;
  index: string;
  /** Stored alongside so document boosts survive a reload. */
  docs: Record<string, Pick<SearchDoc, "kind" | "entityId" | "title" | "href" | "updatedAt" | "degree">>;
}

type StoredFields = Pick<SearchDoc, "kind" | "entityId" | "title" | "href" | "updatedAt" | "degree">;

function miniSearchOptions(): Options<SearchDoc> {
  return {
    idField: "id",
    fields: [...SEARCH_FIELDS],
    storeFields: ["kind", "entityId", "title", "href", "updatedAt", "degree"],
    // Arrays would otherwise stringify with commas glued to terms.
    extractField: (doc, field) => {
      const value = (doc as unknown as Record<string, unknown>)[field];
      return Array.isArray(value) ? value.join(" ") : ((value as string) ?? "");
    },
  };
}

class MiniSearchWorkspaceIndex implements IWorkspaceSearchIndex {
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
    const trimmed = query.trim();
    if (!trimmed) return [];

    const limit = Math.max(1, Math.min(options.limit ?? 30, 200));
    const kinds = options.kinds ? new Set(options.kinds) : null;

    const results = this.engine.search(trimmed, {
      boost: { ...FIELD_BOOSTS },
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
        return documentBoost({ ...(fields as SearchDoc), degree: fields.degree ?? 0 });
      },
      filter: kinds ? (result) => kinds.has((result as SearchResult & StoredFields).kind) : undefined,
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
        terms: result.terms,
      };
    });
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
export function buildSearchIndex(docs: readonly SearchDoc[], revision: string): IWorkspaceSearchIndex {
  const index = miniSearchIndexFactory.create(docs) as MiniSearchWorkspaceIndex;
  index.revision = revision;
  return index;
}
