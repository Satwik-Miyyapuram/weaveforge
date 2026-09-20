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
import { ProjectScopedSupabaseRepository } from "@/backend/providers/supabase/project-scoped-repository";
import {
  type AnnotationQuotationTypeRow,
  toDomain,
} from "./annotation-quotation-type-rows";
import { oneRow, rows, run } from "@/backend/providers/supabase/row-access";

/**
 * The columns a AnnotationQuotationTypeRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
const ANNOTATION_QUOTATION_TYPE_COLUMNS = "id,paper_id,annotation_key,quotation_type,created_at,updated_at";

const TABLE = "annotation_quotation_types";

export class SupabaseAnnotationQuotationTypeRepository extends ProjectScopedSupabaseRepository
  implements IAnnotationQuotationTypeRepository {
  protected readonly action = "managing quotation types";

  async save(input: SaveAnnotationQuotationTypeInput): Promise<AnnotationQuotationType> {
    if (!isQuotationType(input.quotationType)) {
      throw new Error(`Invalid quotation type: ${input.quotationType}`);
    }
    const userId = await this.session.requireUserId();
    const now = new Date().toISOString();
    const dbRow = await oneRow<AnnotationQuotationTypeRow>(this.db
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
      .select(ANNOTATION_QUOTATION_TYPE_COLUMNS)
      .single());
    return toDomain(dbRow);
  }

  async remove(paperId: string, annotationKey: string): Promise<void> {
    await run(this.db
      .from(TABLE)
      .delete()
      .eq("project_id", this.projectId)
      .eq("paper_id", paperId)
      .eq("annotation_key", annotationKey));
  }

  async listForPaper(paperId: string): Promise<AnnotationQuotationType[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    return (await rows<AnnotationQuotationTypeRow>(this.db
      .from(TABLE)
      .select(ANNOTATION_QUOTATION_TYPE_COLUMNS)
      .eq("project_id", projectId)
      .eq("paper_id", paperId)
      .order("created_at", { ascending: true }))).map(toDomain);
  }
}

