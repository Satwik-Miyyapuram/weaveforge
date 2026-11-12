import MiniSearch, { type Options, type SearchResult } from "minisearch";
import { type IWorkspaceSearchIndex, type IWorkspaceSearchIndexFactory, type SearchDoc, type SearchHit, type SearchSettings, type SearchKind, type SearchQueryOptions } from "@weaveforge/core";
import type { MiniSearchDocs, ParsedQuery } from "@weaveforge/wasm";
import { type RustCore, readyCore, typedCore } from "@/lib/rust-core";

/** The Rust core calls this index makes that depend on the injected core. */
type SearchCore = Pick<RustCore, "parseQuery" | "planFuzzyRetry" | "MiniSearchDocs">;

/**
 * BM25 index over the workspace snapshot. The only module that imports
 * MiniSearch — the ranking rules themselves live in `@weaveforge/core` so they stay
 * testable without a library and can later be exposed as user settings.
 */

/**
 * Bumped whenever the indexed shape or tuning changes. A persisted index from a
 * different schema is discarded rather than migrated: rebuilding costs a few
 * hundred milliseconds, whereas a subtly mismatched index returns wrong results
 * indefinitely with no visible symptom.
 *
 * 4: terms come from the Rust tokenizer (P1.8).
 */
export const SEARCH_SCHEMA_VERSION = 4;

interface PersistedIndex {
  schemaVersion: number;
  revision: string;
  index: string;
  /** Stored alongside so document boosts survive a reload. */
  docs: Record<string, StoredFields>;
}

/**
 * The fields kept per document, in the order the persisted snapshot writes
 * them. One list for the type, the MiniSearch options and `add`.
 */
const STORED_FIELDS = [
  "kind", "entityId", "title", "href", "updatedAt", "degree", "path", "tags", "body", "page",
] as const satisfies readonly (keyof SearchDoc)[];

type StoredFields = Pick<SearchDoc, (typeof STORED_FIELDS)[number]>;

/** What the Rust store takes: the stored fields plus the id and the parsed `updatedAt`. */
type DocRecordInput = StoredFields & { id: string; updatedMs: number | null };

function storedFieldsOf(doc: SearchDoc): StoredFields {
  const out: Record<string, unknown> = {};
  for (const field of STORED_FIELDS) out[field] = doc[field];
  return out as StoredFields;
}

function recordOf(id: string, fields: StoredFields): DocRecordInput {
  const updatedMs = Date.parse(fields.updatedAt);
  return { ...fields, id, updatedMs: Number.isNaN(updatedMs) ? null : updatedMs };
}

/** No terms: only filters, if any. */
function isFilterOnly(parsed: ParsedQuery): boolean {
  return parsed.text.length === 0;
}

/** Nothing to search or filter on. */
function isEmptyQuery(parsed: ParsedQuery): boolean {
  return isFilterOnly(parsed) && parsed.kinds.length === 0 && parsed.paths.length === 0 &&
    parsed.tags.length === 0 && parsed.exclude.length === 0 && parsed.modifiedWithinDays === null;
}

function miniSearchOptions(): Options<SearchDoc> {
  return {
    idField: "id",
    fields: [...typedCore().SEARCH_FIELDS],
    // `path`, `tags`, and `body` are stored so field filters and excerpting can
    // work against the same text the ranker saw.
    storeFields: [...STORED_FIELDS],
    // Arrays would otherwise stringify with commas glued to terms.
    extractField: (doc, field) => {
      const value = (doc as unknown as Record<string, unknown>)[field];
      return Array.isArray(value) ? value.join(" ") : ((value as string) ?? "");
    },
    // indexTermsOf already processes terms; MiniSearch also tokenizes queries with
    // this, so index and query share one tokenizer or terms never match.
    tokenize: (text) => readyCore().indexTermsOf(text),
    processTerm: (term) => term,
  };
}

/**
 * MiniSearch scores the text; the Rust store holds the stored documents and
 * applies filters, document boosts, hit mapping and excerpts.
 */
class MiniSearchWorkspaceIndex implements IWorkspaceSearchIndex {
  /** User ranking preferences; defaults apply when unset. Field boosts stay here, for MiniSearch. */
  settings: SearchSettings | undefined;
  /** Document boosts by id, read by MiniSearch's `boostDocument`; filled by `refreshBoosts`. */
  private readonly boostMap = new Map<string, number>();
  /** Set whenever the store or the settings change; cleared once `boostMap` is rebuilt. */
  private boostsDirty = true;
  /** The `now` the table was built at: recency decays with time, so the table follows it. */
  private boostsAt = NaN;

  constructor(
    private readonly core: SearchCore,
    private readonly engine: MiniSearch<SearchDoc>,
    private readonly store: MiniSearchDocs,
    public revision: string,
  ) {}

  replaceAll(docs: readonly SearchDoc[]): void {
    this.engine.removeAll();
    this.store.clear();
    this.add(docs);
  }

  add(docs: readonly SearchDoc[]): void {
    // Re-adding an existing id throws in MiniSearch, so replace explicitly.
    for (const doc of docs) {
      if (this.store.has(doc.id)) this.engine.discard(doc.id);
    }
    this.store.put(docs.map((doc) => recordOf(doc.id, storedFieldsOf(doc))));
    this.boostsDirty = true;
    this.engine.addAll(docs as SearchDoc[]);
  }

  idsOfKind(kinds: readonly SearchKind[]): string[] {
    return this.store.idsOfKind(kinds) as string[];
  }

  hitById(id: string): SearchHit | null {
    return this.store.hitById(id) as SearchHit | null;
  }

  remove(ids: readonly string[]): void {
    for (const id of ids) {
      if (!this.store.has(id)) continue;
      this.engine.discard(id);
      this.store.remove(id);
      this.boostsDirty = true;
    }
  }

  search(query: string, options: SearchQueryOptions = {}): readonly SearchHit[] {
    const parsed = this.core.parseQuery(query);
    if (isEmptyQuery(parsed)) return [];

    const limit = Math.max(1, Math.min(options.limit ?? 30, 200));
    const now = Date.now();
    // Caller-supplied kinds and `kind:` in the query intersect in the store — a
    // screen scoped to notes must not be widened by typing `kind:paper`.
    const kinds = options.kinds ?? null;

    // A filter-only query ("kind:note", "tag:vae") has nothing to rank, so the
    // store enumerates its documents and applies the filters to all of them.
    if (isFilterOnly(parsed)) {
      return this.store.filterOnly(parsed, kinds, limit, now) as SearchHit[];
    }

    this.refreshBoosts(now);

    const run = (fuzzyFor: (term: string) => number) =>
      this.engine.search(parsed.text, {
        boost: typedCore().effectiveFieldBoosts(this.settings ?? {}),
        prefix: (term) => (options.prefix === false ? false : term.length >= typedCore().MIN_PREFIX_LENGTH),
        fuzzy: fuzzyFor,
        // Document-level signal: link degree first, recency only as a tiebreak.
        boostDocument: (id) => this.boostMap.get(String(id)) ?? 1,
      });

    // Filters, the document boost, the limit and excerpts all happen in the store.
    // An empty array means nothing passed the filters.
    const rank = (results: readonly SearchResult[]) =>
      this.store.finish(results, parsed, kinds, limit, now, !!options.excerpts) as SearchHit[];

    const firstPass = (term: string) =>
      typeof options.fuzzy === "number"
        ? options.fuzzy
        : options.fuzzy === false
          ? 0
          : typedCore().fuzzinessForTerm(term);

    let hits = rank(run(firstPass));

    // Nothing matched. Before reporting an empty result, allow one more edit
    // per term — which is what a transposition costs under Levenshtein, and the
    // reason "nerual" cannot reach "neural" on the first pass. Only queries that
    // already failed pay for this, so the common path is untouched.
    if (hits.length === 0 && options.fuzzy !== false && typeof options.fuzzy !== "number") {
      const plan = this.core.planFuzzyRetry({
        resultCount: 0,
        termCount: parsed.text.split(/\s+/).filter(Boolean).length,
      });
      if (plan.retry) hits = rank(run((term) => plan.fuzzinessFor(term)));
    }

    return hits;
  }

  /** Apply ranking preferences: MiniSearch keeps the field boosts, the store keeps the rest. */
  applySettings(settings: SearchSettings | undefined): void {
    this.settings = settings;
    this.store.setSettings(settings);
    this.boostsDirty = true;
  }

  /**
   * One wasm call rebuilds every document's boost, instead of one call per candidate
   * per term. Skipped while the store is unchanged and `now` has not moved.
   */
  private refreshBoosts(now: number): void {
    if (!this.boostsDirty && this.boostsAt === now) return;
    const { ids, boosts } = this.store.boosts(now) as { ids: string[]; boosts: number[] };
    this.boostMap.clear();
    ids.forEach((id, i) => this.boostMap.set(id, boosts[i] ?? 1));
    this.boostsDirty = false;
    this.boostsAt = now;
  }

  serialize(): string {
    const payload: PersistedIndex = {
      schemaVersion: SEARCH_SCHEMA_VERSION,
      revision: this.revision,
      index: JSON.stringify(this.engine),
      docs: Object.fromEntries(this.store.entries() as [string, StoredFields][]),
    };
    return JSON.stringify(payload);
  }
}

/** Factory bound to the Rust core that tokenizes and parses for this index. */
export function createMiniSearchIndexFactory(core: SearchCore): IWorkspaceSearchIndexFactory {
  return {
    create(docs: readonly SearchDoc[]): IWorkspaceSearchIndex {
      const engine = new MiniSearch<SearchDoc>(miniSearchOptions());
      const index = new MiniSearchWorkspaceIndex(core, engine, new core.MiniSearchDocs(), "");
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
        const store = new core.MiniSearchDocs();
        store.put(Object.entries(payload.docs ?? {}).map(([id, fields]) => recordOf(id, fields)));
        return new MiniSearchWorkspaceIndex(core, engine, store, payload.revision);
      } catch {
        return null;
      }
    },
  };
}

/** Build an index and stamp it with the corpus revision. */
export function buildSearchIndex(
  core: SearchCore,
  docs: readonly SearchDoc[],
  revision: string,
  settings?: SearchSettings,
): IWorkspaceSearchIndex {
  const index = createMiniSearchIndexFactory(core).create(docs) as MiniSearchWorkspaceIndex;
  index.revision = revision;
  index.applySettings(settings);
  return index;
}

/** Apply new ranking preferences without rebuilding the index. */
export function applySearchSettings(index: IWorkspaceSearchIndex, settings?: SearchSettings): void {
  (index as MiniSearchWorkspaceIndex).applySettings(settings);
}
