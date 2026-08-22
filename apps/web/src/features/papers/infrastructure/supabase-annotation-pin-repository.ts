import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AnnotationPin,
  IAnnotationPinRepository,
  ICurrentUserProvider,
  SaveAnnotationPinInput,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import { ProjectScopedSupabaseRepository } from "@/backend/providers/supabase/project-scoped-repository";
import {
  type AnnotationPinRow,
  toDomain,
} from "./annotation-pin-rows";
import { rows, run } from "@/backend/providers/supabase/row-access";

const TABLE = "annotation_pins";

export class SupabaseAnnotationPinRepository extends ProjectScopedSupabaseRepository implements IAnnotationPinRepository {
  protected readonly action = "managing annotation pins";

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
    await run(this.db
      .from(TABLE)
      .delete()
      .eq("project_id", this.projectId)
      .eq("paper_id", paperId)
      .eq("annotation_key", annotationKey));
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
    return (await rows<AnnotationPinRow>(query.order("created_at", { ascending: true }))).map(toDomain);
  }
}

