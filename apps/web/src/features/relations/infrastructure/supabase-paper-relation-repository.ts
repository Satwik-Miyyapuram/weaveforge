import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IPaperRelationRepository,
  PaperRelation,
  PaperRelationFilter,
  RelationType,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import {
  type PaperRelationRow,
  toDomain,
  toRow,
} from "./paper-relation-rows";
import { deleteRowById, rowById, rows, run } from "@/backend/providers/supabase/row-access";

/**
 * Supabase implementation of IPaperRelationRepository.
 *
 * Persistence only (snake_case <-> camelCase). Must pass the same contract
 * suite as the in-memory repository.
 */

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
    const row = await rowById<PaperRelationRow>(this.db, TABLE, id);
    return row ? toDomain(row) : null;
  }

  async list(filter?: PaperRelationFilter): Promise<PaperRelation[]> {
    let query = this.db.from(TABLE).select("*");
    if (this.pid) query = query.eq("project_id", this.pid);
    if (filter?.relation) query = query.eq("relation", filter.relation);
    if (filter?.fromPaper) query = query.eq("from_paper", filter.fromPaper);
    if (filter?.toPaper) query = query.eq("to_paper", filter.toPaper);
    query = query.order("created_at", { ascending: true });
    return (await rows<PaperRelationRow>(query)).map(toDomain);
  }

  async getGraph(): Promise<PaperRelation[]> {
    let q = this.db.from(TABLE).select("*");
    if (this.pid) q = q.eq("project_id", this.pid);
    return (await rows<PaperRelationRow>(q)).map(toDomain);
  }

  async relationsFor(paperId: string): Promise<PaperRelation[]> {
    let q = this.db.from(TABLE).select("*").or(`from_paper.eq.${paperId},to_paper.eq.${paperId}`);
    if (this.pid) q = q.eq("project_id", this.pid);
    return (await rows<PaperRelationRow>(q)).map(toDomain);
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
    await run(this.db.from(TABLE).upsert(row, {
      onConflict: "from_paper,to_paper,relation",
    }));
  }

  async delete(id: string): Promise<void> {
    await deleteRowById(this.db, TABLE, id);
  }
}

