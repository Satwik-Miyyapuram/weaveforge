import type { SupabaseClient } from "@supabase/supabase-js";
import type { ICurrentUserProvider, IProjectRepository, Project } from "@weaveforge/core";
import {
  type ProjectRow,
  toDomain,
} from "./project-rows";

const TABLE = "projects";

export class SupabaseProjectRepository implements IProjectRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly session: ICurrentUserProvider,
  ) {}

  async getById(id: string): Promise<Project | null> {
    const { data, error } = await this.db.from(TABLE).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toDomain(data as ProjectRow) : null;
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
    const { error } = await this.db.from(TABLE).delete().eq("id", id);
    if (error) throw error;
  }
}
