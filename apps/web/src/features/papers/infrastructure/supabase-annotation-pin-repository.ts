import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AnnotationPin,
  IAnnotationPinRepository,
  ICurrentUserProvider,
  SaveAnnotationPinInput,
} from "@thesis/core";
import type { ProjectContext } from "@/lib/project-context";

interface AnnotationPinRow {
  id: string;
  paper_id: string;
  annotation_key: string;
  report_section_id: string;
  created_at: string;
}

const TABLE = "annotation_pins";

export class SupabaseAnnotationPinRepository implements IAnnotationPinRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
    private readonly session: ICurrentUserProvider,
  ) {}

  private get projectId() {
    const id = this.ctx.projectId;
    if (!id) throw new Error("Select a project before managing annotation pins.");
    return id;
  }

  async save(input: SaveAnnotationPinInput): Promise<AnnotationPin> {
    const userId = await this.session.requireUserId();
    const { data, error } = await this.db
      .from(TABLE)
      .upsert(
        {
          user_id: userId,
          project_id: this.projectId,
          paper_id: input.paperId,
          annotation_key: input.annotationKey,
          report_section_id: input.reportSectionId,
        },
        { onConflict: "project_id,paper_id,annotation_key" },
      )
      .select("*")
      .single();
    if (error) throw error;
    return toDomain(data as AnnotationPinRow);
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

  listForProject(): Promise<AnnotationPin[]> {
    return this.list();
  }

  listForPaper(paperId: string): Promise<AnnotationPin[]> {
    return this.list({ paperId });
  }

  listForSection(reportSectionId: string): Promise<AnnotationPin[]> {
    return this.list({ reportSectionId });
  }

  private async list(filter?: {
    paperId?: string;
    reportSectionId?: string;
  }): Promise<AnnotationPin[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    let query = this.db.from(TABLE).select("*").eq("project_id", projectId);
    if (filter?.paperId) query = query.eq("paper_id", filter.paperId);
    if (filter?.reportSectionId) {
      query = query.eq("report_section_id", filter.reportSectionId);
    }
    const { data, error } = await query.order("created_at", { ascending: true });
    if (error) throw error;
    return (data as AnnotationPinRow[]).map(toDomain);
  }
}

function toDomain(row: AnnotationPinRow): AnnotationPin {
  return {
    id: row.id,
    paperId: row.paper_id,
    annotationKey: row.annotation_key,
    reportSectionId: row.report_section_id,
    createdAt: row.created_at,
  };
}
