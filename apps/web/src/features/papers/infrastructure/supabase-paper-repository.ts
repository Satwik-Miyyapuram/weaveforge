import {
  normalizeDoi,
  type IPaperRepository,
  type Paper,
  type PaperFilter,
  type PaperIdentity,
  type PaperSummary,
} from "@weaveforge/core";
import type { EntityStamp } from "@weaveforge/core";
import {
  type PaperRow,
  toRow,
  toDomain,
} from "./paper-rows";
import { one, rows, run } from "@/backend/providers/supabase/row-access";
import { ProjectRepository } from "@/backend/providers/supabase/project-scoped-repository";

/**
 * Supabase implementation of IPaperRepository.
 *
 * The ONLY job of this class is persistence against the `papers` table,
 * including the snake_case <-> camelCase mapping. No business rules live here.
 * It must pass the same contract test suite as the in-memory repository
 * (run `runPaperRepositoryContract` against an instance pointed at a test DB).
 *
 * Every read goes through `this.scoped(...)`. Two of them did not, and the
 * omission is invisible on the hosted path because RLS is what actually filters
 * there — it shows up on a self-hosted Postgres or the local backend, where the
 * same call returns another project's rows into this project's sync, search
 * index and prefetch.
 *
 * Queries are built in single steps (`query = query.eq(...)`) rather than as
 * chained expressions. That is not style: writing the chain inline makes
 * TypeScript instantiate the whole Postgrest builder type at each call, and
 * several of these methods then fail to compile with TS2589 ("type
 * instantiation is excessively deep").
 */

const TABLE = "papers";

/** Ids per `in (...)` request; the list travels in the URL. */
const ID_CHUNK = 200;

/** Full list projection for sync/search consumers that need abstracts/bibtex. */
const PAPER_LIST_COLUMNS =
  "id,title,authors,status,year,read_at,pdf_path,tags,created_at,updated_at,doi_bidx,arxiv_bidx,venue,abstract,summary,doi,arxiv_id,url,bibtex,metadata,rating,project_id";

/** Card / screen projection — fields the papers grid paints (no abstract/bibtex/metadata). */
const PAPER_SUMMARY_COLUMNS =
  "id,title,authors,status,year,read_at,pdf_path,tags,created_at,updated_at,project_id,summary,doi,arxiv_id,url";

/** What a delta read needs: the id it keys on, and the two version columns. */
const PAPER_STAMP_COLUMNS = "id,updated_at,created_at";

/**
 * What a citation link reads, and nothing else.
 *
 * The narrowest projection here, and the only one whose type agrees with it: see
 * `IPaperIdentityLookup`. `status` is in it because the reference popover says
 * whether the reader has read the paper it linked to.
 */
const PAPER_IDENTITY_COLUMNS = "id,title,status";

export class SupabasePaperRepository extends ProjectRepository implements IPaperRepository {

  async getById(id: string): Promise<Paper | null> {
    let query = this.scoped(this.db.from(TABLE).select(PAPER_LIST_COLUMNS));
    query = query.eq("id", id);
    const row = await one<PaperRow>(query.maybeSingle());
    return row ? toDomain(row) : null;
  }

  /**
   * Ids and versions only — the cheap first half of a delta read.
   *
   * Two columns over the whole table is a fraction of a percent of what the
   * rows themselves weigh, and it is what lets the caller ask for the handful
   * that actually changed.
   *
   * Deliberately not "changed since T": a deletion reports no row at all, so a
   * snapshot built from a time window accumulates entities the database no
   * longer has. The complete stamp set is what lets the caller compute the
   * drops.
   */
  async listStamps(): Promise<EntityStamp[]> {
    let query = this.scoped(this.db.from(TABLE).select(PAPER_STAMP_COLUMNS));
    query = query.order("created_at", { ascending: false });
    query = query.order("id", { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    return (data as { id: string; updated_at: string | null; created_at: string }[]).map((row) => ({
      id: row.id,
      updatedAt: row.updated_at ?? row.created_at,
    }));
  }

  /**
   * Papers by id, project-scoped, in chunks requested together.
   *
   * Chunked because an `in` list travels in the URL and a few thousand ids pass
   * the server's line-length limit; issued concurrently because ten sequential
   * round trips for a 2 000-id delta read is nine round trips nobody asked for.
   * The order is by `id`, not the order the ids were asked for, which is what
   * makes it deterministic — a caller that pairs rows against its own id list
   * should build a Map from the result.
   */
  async listByIds(ids: readonly string[]): Promise<Paper[]> {
    if (ids.length === 0) return [];
    const chunks: string[][] = [];
    for (let start = 0; start < ids.length; start += ID_CHUNK) {
      chunks.push(ids.slice(start, start + ID_CHUNK) as string[]);
    }
    const pages = await Promise.all(
      chunks.map((chunk) => {
        let query = this.scoped(this.db.from(TABLE).select(PAPER_LIST_COLUMNS));
        query = query.in("id", chunk);
        query = query.order("id", { ascending: true });
        return rows<PaperRow>(query);
      }),
    );
    return pages.flat().map(toDomain);
  }

  async list(filter?: PaperFilter): Promise<Paper[]> {
    let query = this.scoped(this.db.from(TABLE).select(PAPER_LIST_COLUMNS));
    if (filter?.status) query = query.eq("status", filter.status);
    if (filter?.arxivId) query = query.eq("arxiv_id", filter.arxivId);
    if (filter?.doi) {
      // `normalizeDoi` returns undefined for anything that is not a DOI, and
      // asserting it non-null turned "this filter is not a DOI" into a filter on
      // `undefined` — either a request error or a match on nothing, depending on
      // the client version, with nothing to tell the caller which. A DOI that
      // cannot be normalised is not a DOI this library holds.
      const doi = normalizeDoi(filter.doi);
      if (doi) query = query.eq("doi", doi);
    }
    if (filter?.titleContains) {
      query = query.ilike("title", `%${filter.titleContains}%`);
    }
    // `created_at` alone is not a total order: papers imported together share a
    // timestamp, and Postgres is then free to return those rows in any order.
    // The card grid deals items into real columns by position, so a reshuffled
    // tie moves cards between columns — remounting them, and closing whatever
    // dialog one of them had open. `id` makes the order total.
    query = query.order("created_at", { ascending: false });
    query = query.order("id", { ascending: true });
    return (await rows<PaperRow>(query)).map(toDomain);
  }

  /**
   * The card projection. Typed as a summary because that is what it is.
   *
   * It said `Paper[]` while selecting summary columns, which is the review-2 F6
   * mistake at the repository boundary: the compiler believed every element had
   * an abstract and a metadata bag, and any path that read one and wrote the
   * entity back persisted `undefined` over real data. A `Paper` still satisfies
   * `PaperSummary`, so an implementation with the whole row may return it — but
   * a caller may only rely on the summary fields, and now cannot rely on more.
   */
  async listSummaries(): Promise<PaperSummary[]> {
    let query = this.scoped(this.db.from(TABLE).select(PAPER_SUMMARY_COLUMNS));
    query = query.order("created_at", { ascending: false });
    query = query.order("id", { ascending: true });
    return (await rows<PaperRow>(query)).map(toDomain);
  }

  async save(entity: Paper): Promise<void> {
    const row = toRow(entity);
    if (this.pid) row.project_id = this.pid;
    await run(this.db.from(TABLE).upsert(row, { onConflict: "id" }));
  }

  async delete(id: string): Promise<void> {
    let query = this.scoped(this.db.from(TABLE).delete());
    query = query.eq("id", id);
    await run(query);
  }

  /**
   * One row by a unique-ish column, scoped to the project.
   *
   * Four copies of this existed, differing only in the column literal — and the
   * project guard had been added to the other methods and to these four
   * individually, which is exactly how one of them came to be missing it.
   *
   * The projection is the full list one rather than the three columns a dedupe
   * check strictly needs: the port promises a `Paper`, and a dedupe hit is
   * handed straight back to the caller as the paper it found. Narrowing the
   * columns without narrowing the type would be the same lie `listSummaries`
   * used to tell. A caller that only needs identity wants a narrower port, not
   * fewer columns behind this one.
   */
  private async findBy(
    column: "arxiv_id" | "doi",
    value: string,
  ): Promise<Paper | null> {
    let query = this.scoped(this.db.from(TABLE).select(PAPER_LIST_COLUMNS));
    query = query.eq(column, value);
    const row = await one<PaperRow>(query.maybeSingle());
    return row ? toDomain(row) : null;
  }

  async findByArxivId(arxivId: string): Promise<Paper | null> {
    return this.findBy("arxiv_id", arxivId);
  }

  async findByDoi(doi: string): Promise<Paper | null> {
    const normalized = normalizeDoi(doi);
    return normalized ? this.findBy("doi", normalized) : null;
  }

  /**
   * The three columns a citation link reads, and nothing else.
   *
   * This is the narrower port the comment above asks for: a citation naming a
   * DOI wants to know whether the library has it, what it is called and whether
   * it has been read. Answering with a whole `Paper` transferred the abstract,
   * the bibtex and the metadata bag of every reference matched, on a path that
   * walks a bibliography.
   */
  async findIdentityByArxivId(arxivId: string): Promise<PaperIdentity | null> {
    return this.findIdentity("arxiv_id", arxivId);
  }

  async findIdentityByDoi(doi: string): Promise<PaperIdentity | null> {
    const normalized = normalizeDoi(doi);
    return normalized ? this.findIdentity("doi", normalized) : null;
  }

  private async findIdentity(
    column: "arxiv_id" | "doi",
    value: string,
  ): Promise<PaperIdentity | null> {
    let query = this.scoped(this.db.from(TABLE).select(PAPER_IDENTITY_COLUMNS));
    query = query.eq(column, value);
    const row = await one<Pick<PaperRow, "id" | "title" | "status">>(query.maybeSingle());
    if (!row) return null;
    return { id: row.id, title: row.title, status: row.status as PaperIdentity["status"] };
  }
}
