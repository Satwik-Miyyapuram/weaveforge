import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AnnotationQuotationType,
  IAnnotationQuotationTypeRepository,
  ICurrentUserProvider,
  QuotationType,
  SaveAnnotationQuotationTypeInput,
} from "@weaveforge/core";
import { isQuotationType } from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";

interface AnnotationQuotationTypeRow {
  id: string;
  paper_id: string;
  annotation_key: string;
  quotation_type: string;
  created_at: string;
  updated_at: string;
}

const TABLE = "annotation_quotation_types";

export class SupabaseAnnotationQuotationTypeRepository
  implements IAnnotationQuotationTypeRepository
{
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
    private readonly session: ICurrentUserProvider,
  ) {}

  private get projectId() {
    const id = this.ctx.projectId;
    if (!id) throw new Error("Select a project before managing quotation types.");
    return id;
  }

  async save(input: SaveAnnotationQuotationTypeInput): Promise<AnnotationQuotationType> {
    if (!isQuotationType(input.quotationType)) {
      throw new Error(`Invalid quotation type: ${input.quotationType}`);
    }
    const userId = await this.session.requireUserId();
    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from(TABLE)
      .upsert(
        {
          user_id: userId,
          project_id: this.projectId,
          paper_id: input.paperId,
          annotation_key: input.annotationKey,
          quotation_type: input.quotationType,
          updated_at: now,
        },
        { onConflict: "project_id,paper_id,annotation_key" },
      )
      .select("*")
      .single();
    if (error) throw error;
    return toDomain(data as AnnotationQuotationTypeRow);
  }

  async remove(paperId: string, annotationKey: string): Promise<void> {
    const { error } = await this.db
      .from(TABLE)
      .delete()
      .eq("project_id", this.projectId)
      .eq("paper_id", paperId)
      .eq("annotation_key", annotationKey);
    if (error) throw error;
  }

  async listForPaper(paperId: string): Promise<AnnotationQuotationType[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    const { data, error } = await this.db
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .eq("paper_id", paperId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as AnnotationQuotationTypeRow[]).map(toDomain);
  }
}

function toDomain(row: AnnotationQuotationTypeRow): AnnotationQuotationType {
  if (!isQuotationType(row.quotation_type)) {
    throw new Error(`Invalid quotation type in store: ${row.quotation_type}`);
  }
  return {
    id: row.id,
    paperId: row.paper_id,
    annotationKey: row.annotation_key,
    quotationType: row.quotation_type as QuotationType,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
