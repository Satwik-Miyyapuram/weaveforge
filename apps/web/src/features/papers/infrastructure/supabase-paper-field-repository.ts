import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ICurrentUserProvider,
  IPaperFieldRepository,
  PaperFieldDef,
  PaperFieldKind,
  PaperFieldValue,
  PaperFieldValueData,
  SetPaperFieldValueInput,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import {
  type DefRow,
  type ValueRow,
  toDef,
  toValue,
  asStringArray,
  asValueData,
} from "./paper-field-rows";

const DEFS = "paper_field_defs";
const VALUES = "paper_field_values";

export class SupabasePaperFieldRepository implements IPaperFieldRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
    private readonly session: ICurrentUserProvider,
  ) {}

  private get projectId() {
    const id = this.ctx.projectId;
    if (!id) throw new Error("Select a project before managing paper fields.");
    return id;
  }

  async listDefs(): Promise<PaperFieldDef[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    const { data, error } = await this.db
      .from(DEFS)
      .select("id, name, kind, options, sort_order")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw error;
    return (data as DefRow[]).map(toDef);
  }

  async saveDef(def: PaperFieldDef): Promise<void> {
    const userId = await this.session.requireUserId();
    const { error } = await this.db.from(DEFS).upsert(
      {
        id: def.id,
        user_id: userId,
        project_id: this.projectId,
        name: def.name,
        kind: def.kind,
        options: def.options,
        sort_order: def.sortOrder,
      },
      { onConflict: "id" },
    );
    if (error) throw error;
  }

  async deleteDef(id: string): Promise<void> {
    const { error } = await this.db
      .from(DEFS)
      .delete()
      .eq("project_id", this.projectId)
      .eq("id", id);
    if (error) throw error;
  }

  listValuesForPaper(paperId: string): Promise<PaperFieldValue[]> {
    return this.listValues(paperId);
  }

  listValuesForProject(): Promise<PaperFieldValue[]> {
    return this.listValues();
  }

  async setValue(input: SetPaperFieldValueInput): Promise<PaperFieldValue> {
    const userId = await this.session.requireUserId();
    const { data, error } = await this.db
      .from(VALUES)
      .upsert(
        {
          user_id: userId,
          project_id: this.projectId,
          paper_id: input.paperId,
          field_id: input.fieldId,
          value: input.value,
        },
        { onConflict: "project_id,paper_id,field_id" },
      )
      .select("id, paper_id, field_id, value")
      .single();
    if (error) throw error;
    return toValue(data as ValueRow);
  }

  async removeValue(paperId: string, fieldId: string): Promise<void> {
    const { error } = await this.db
      .from(VALUES)
      .delete()
      .eq("project_id", this.projectId)
      .eq("paper_id", paperId)
      .eq("field_id", fieldId);
    if (error) throw error;
  }

  private async listValues(paperId?: string): Promise<PaperFieldValue[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    let query = this.db
      .from(VALUES)
      .select("id, paper_id, field_id, value")
      .eq("project_id", projectId);
    if (paperId) query = query.eq("paper_id", paperId);
    const { data, error } = await query
      .order("paper_id", { ascending: true })
      .order("field_id", { ascending: true });
    if (error) throw error;
    return (data as ValueRow[]).map(toValue);
  }
}

