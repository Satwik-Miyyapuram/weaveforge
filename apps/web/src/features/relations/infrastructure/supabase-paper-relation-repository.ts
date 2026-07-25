import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IPaperRelationRepository,
  PaperRelation,
  PaperRelationFilter,
  RelationType,
} from "@thesis/core";
import type { ProjectContext } from "@/lib/project-context";

/**
 * Supabase implementation of IPaperRelationRepository.
 *
 * Persistence only (snake_case <-> camelCase). Must pass the same contract
 * suite as the in-memory repository.
 */

interface PaperRelationRow {
  id: string;
  from_paper: string;
  to_paper: string;
  relation: RelationType;
  note: string | null;
  source: "manual" | "auto";
  created_at: string;
}

const TABLE = "paper_relations";

export class SupabasePaperRelationRepository
  implements IPaperRelationRepository
{
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
  ) {}
  private get pid() { return this.ctx.projectId; }

  async getById(id: string): Promise<PaperRelation | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? toDomain(data as PaperRelationRow) : null;
  }

  async list(filter?: PaperRelationFilter): Promise<PaperRelation[]> {
    let query = this.db.from(TABLE).select("*");
    if (this.pid) query = query.eq("project_id", this.pid);
    if (filter?.relation) query = query.eq("relation", filter.relation);
    if (filter?.fromPaper) query = query.eq("from_paper", filter.fromPaper);
    if (filter?.toPaper) query = query.eq("to_paper", filter.toPaper);
    query = query.order("created_at", { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    return (data as PaperRelationRow[]).map(toDomain);
  }

  async getGraph(): Promise<PaperRelation[]> {
    let q = this.db.from(TABLE).select("*");
    if (this.pid) q = q.eq("project_id", this.pid);
    const { data, error } = await q;
    if (error) throw error;
    return (data as PaperRelationRow[]).map(toDomain);
  }

  async relationsFor(paperId: string): Promise<PaperRelation[]> {
    let q = this.db.from(TABLE).select("*").or(`from_paper.eq.${paperId},to_paper.eq.${paperId}`);
    if (this.pid) q = q.eq("project_id", this.pid);
    const { data, error } = await q;
    if (error) throw error;
    return (data as PaperRelationRow[]).map(toDomain);
  }

  async findEdge(
    fromPaper: string,
    toPaper: string,
    relation: RelationType,
  ): Promise<PaperRelation | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select("*")
      .eq("from_paper", fromPaper)
      .eq("to_paper", toPaper)
      .eq("relation", relation)
      .maybeSingle();
    if (error) throw error;
    return data ? toDomain(data as PaperRelationRow) : null;
  }

  async save(entity: PaperRelation): Promise<void> {
    const row = toRow(entity);
    if (this.pid) row.project_id = this.pid;
    const { error } = await this.db.from(TABLE).upsert(row, {
      onConflict: "from_paper,to_paper,relation",
    });
    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.db.from(TABLE).delete().eq("id", id);
    if (error) throw error;
  }
}

function toDomain(row: PaperRelationRow): PaperRelation {
  return {
    id: row.id,
    fromPaper: row.from_paper,
    toPaper: row.to_paper,
    relation: row.relation,
    note: row.note ?? undefined,
    source: row.source,
    createdAt: row.created_at,
  };
}

function toRow(r: PaperRelation): Record<string, unknown> {
  return {
    id: r.id,
    from_paper: r.fromPaper,
    to_paper: r.toPaper,
    relation: r.relation,
    note: r.note ?? null,
    source: r.source,
    created_at: r.createdAt,
  };
}
