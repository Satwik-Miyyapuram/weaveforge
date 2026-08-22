import type { SupabaseClient } from "@supabase/supabase-js";
import type { ICurrentUserProvider, IProjectRepository, Project } from "@weaveforge/core";
import {
  type ProjectRow,
  toDomain,
} from "./project-rows";
import { deleteRowById, rowById } from "@/backend/providers/supabase/row-access";

const TABLE = "projects";

export class SupabaseProjectRepository implements IProjectRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly session: ICurrentUserProvider,
  ) {}

  async getById(id: string): Promise<Project | null> {
    const row = await rowById<ProjectRow>(this.db, TABLE, id);
    return row ? toDomain(row) : null;
  }
  async list(): Promise<Project[]> {
    const { data, error } = await this.db.from(TABLE).select("*").order("created_at");
    if (error) throw error;
    return (data as ProjectRow[]).map(toDomain);
  }
  async save(entity: Project): Promise<void> {
    const userId = await this.session.getCurrentUserId();
    const { error } = await this.db.from(TABLE).upsert({
      id: entity.id,
      user_id: userId,
      name: entity.name,
      color: entity.color ?? null,
      created_at: entity.createdAt,
    });
    if (error) throw error;
  }
  async delete(id: string): Promise<void> {
    await deleteRowById(this.db, TABLE, id);
  }
}
