import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeDoi,
  type IPaperRepository,
  type Paper,
  type PaperFilter,
  type PaperStatus,
} from "@weaveforge/core";
import type { EntityStamp } from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import {
  attachEncryptedRow,
  encryptedRowFields,
  encryptedListRowFields,
} from "@/lib/encrypted-row";

/**
 * Supabase implementation of IPaperRepository.
 *
 * The ONLY job of this class is persistence against the `papers` table,
 * including the snake_case <-> camelCase mapping. No business rules live here.
 * It must pass the same contract test suite as the in-memory repository
 * (run `runPaperRepositoryContract` against an instance pointed at a test DB).
 */

interface PaperRow {
  id: string;
  title: string;
  authors: string[] | null;
  year: number | null;
  venue?: string | null;
  doi?: string | null;
  arxiv_id?: string | null;
  url?: string | null;
  pdf_path?: string | null;
  abstract?: string | null;
  summary?: string | null;
  status: PaperStatus;
  rating?: number | null;
  read_at: string | null;
  bibtex?: string | null;
  tags: string[] | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  doi_bidx?: string | null;
  arxiv_bidx?: string | null;
}

const TABLE = "papers";

/** Full list projection for sync/search consumers that need abstracts/bibtex. */
/** Ids per `in (...)` request; the list travels in the URL. */
const ID_CHUNK = 200;

const PAPER_LIST_COLUMNS =
  "id,title,authors,status,year,read_at,pdf_path,tags,created_at,updated_at,doi_bidx,arxiv_bidx,venue,abstract,summary,doi,arxiv_id,url,bibtex,metadata,rating,project_id";

/** Card / screen projection — fields the papers grid paints (no abstract/bibtex/metadata). */
const PAPER_SUMMARY_COLUMNS =
  "id,title,authors,status,year,read_at,pdf_path,tags,created_at,updated_at,project_id,summary,doi,arxiv_id,url";

export class SupabasePaperRepository implements IPaperRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
  ) {}

  private get pid() { return this.ctx.projectId; }

  async getById(id: string): Promise<Paper | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? toDomain(data as PaperRow) : null;
  }

  /**
   * Ids and versions only — the cheap first half of a delta read.
   *
   * Two columns over the whole table is a fraction of a percent of what the
   * rows themselves weigh, and it is what lets the caller ask for the handful
   * that actually changed.
   */
  async listStamps(): Promise<EntityStamp[]> {
    let query = this.db.from(TABLE).select("id,updated_at,created_at");
    if (this.pid) query = query.eq("project_id", this.pid);
    query = query.order("created_at", { ascending: false });
    const { data, error } = await query;
    if (error) throw error;
    return (data as { id: string; updated_at: string | null; created_at: string }[]).map((row) => ({
      id: row.id,
      updatedAt: row.updated_at ?? row.created_at,
    }));
  }

  async listByIds(ids: readonly string[]): Promise<Paper[]> {
    if (ids.length === 0) return [];
    const out: Paper[] = [];
    // Chunked: an `in` list is part of the URL, and a few thousand ids past
    // the server's line-length limit fails the request outright.
    for (let start = 0; start < ids.length; start += ID_CHUNK) {
      const { data, error } = await this.db
        .from(TABLE)
        .select(PAPER_LIST_COLUMNS)
        .in("id", ids.slice(start, start + ID_CHUNK) as string[]);
      if (error) throw error;
      out.push(...(data as PaperRow[]).map(toDomain));
    }
    return out;
  }

  async list(filter?: PaperFilter): Promise<Paper[]> {
    let query = this.db.from(TABLE).select(PAPER_LIST_COLUMNS);
    if (this.pid) query = query.eq("project_id", this.pid);
    if (filter?.status) query = query.eq("status", filter.status);
    if (filter?.arxivId) query = query.eq("arxiv_id", filter.arxivId);
    if (filter?.doi) query = query.eq("doi", normalizeDoi(filter.doi)!);
    if (filter?.titleContains) {
      query = query.ilike("title", `%${filter.titleContains}%`);
    }
    query = query.order("created_at", { ascending: false });
    const { data, error } = await query;
    if (error) throw error;
    return (data as PaperRow[]).map(toDomain);
  }

  async listSummaries(): Promise<Paper[]> {
    let query = this.db.from(TABLE).select(PAPER_SUMMARY_COLUMNS);
    if (this.pid) query = query.eq("project_id", this.pid);
    query = query.order("created_at", { ascending: false });
    const { data, error } = await query;
    if (error) throw error;
    return (data as PaperRow[]).map(toDomain);
  }

  async save(entity: Paper): Promise<void> {
    const row = toRow(entity);
    if (this.pid) row.project_id = this.pid;
    const { error } = await this.db.from(TABLE).upsert(row, { onConflict: "id" });
    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.db.from(TABLE).delete().eq("id", id);
    if (error) throw error;
  }

  async findByArxivId(arxivId: string): Promise<Paper | null> {
    let q = this.db.from(TABLE).select("*").eq("arxiv_id", arxivId);
    if (this.pid) q = q.eq("project_id", this.pid);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data ? toDomain(data as PaperRow) : null;
  }

  async findByArxivBidx(bidx: string): Promise<Paper | null> {
    let q = this.db.from(TABLE).select("*").eq("arxiv_bidx", bidx);
    if (this.pid) q = q.eq("project_id", this.pid);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data ? toDomain(data as PaperRow) : null;
  }

  async findByDoi(doi: string): Promise<Paper | null> {
    let q = this.db.from(TABLE).select("*").eq("doi", normalizeDoi(doi)!);
    if (this.pid) q = q.eq("project_id", this.pid);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data ? toDomain(data as PaperRow) : null;
  }

  async findByDoiBidx(bidx: string): Promise<Paper | null> {
    let q = this.db.from(TABLE).select("*").eq("doi_bidx", bidx);
    if (this.pid) q = q.eq("project_id", this.pid);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data ? toDomain(data as PaperRow) : null;
  }
}

function toDomain(row: PaperRow): Paper {
  return {
      id: row.id,
      title: row.title,
      authors: row.authors ?? [],
      year: row.year ?? undefined,
      venue: row.venue ?? undefined,
      doi: row.doi ?? undefined,
      arxivId: row.arxiv_id ?? undefined,
      url: row.url ?? undefined,
      pdfPath: row.pdf_path ?? undefined,
      abstract: row.abstract ?? undefined,
      summary: row.summary ?? undefined,
      status: row.status,
      rating: row.rating ?? undefined,
      readAt: row.read_at ?? undefined,
      bibtex: row.bibtex ?? undefined,
      tags: row.tags ?? [],
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
  };
}

function emptyToNull(value: string | undefined | null): string | null {
  if (value == null || value === "") return null;
  return value;
}

function toRow(p: Paper): Record<string, unknown> {
  return {
    id: p.id,
    title: p.title ?? "",
    authors: p.authors ?? [],
    year: p.year ?? null,
    venue: emptyToNull(p.venue),
    doi: p.doi ? emptyToNull(normalizeDoi(p.doi)) : null,
    arxiv_id: emptyToNull(p.arxivId),
    url: emptyToNull(p.url),
    pdf_path: p.pdfPath ?? null,
    abstract: emptyToNull(p.abstract),
    summary: emptyToNull(p.summary),
    status: p.status,
    rating: p.rating ?? null,
    read_at: p.readAt ?? null,
    bibtex: emptyToNull(p.bibtex),
    tags: p.tags ?? [],
    metadata: p.metadata ?? {},
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    doi_bidx: null,
    arxiv_bidx: null,
    ...encryptedRowFields(p),
    ...encryptedListRowFields(p),
  };
}
