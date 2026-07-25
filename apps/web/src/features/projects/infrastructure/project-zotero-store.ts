import type { SupabaseClient } from "@supabase/supabase-js";
import type { IProjectBibliographyCollectionStore } from "@thesis/core";

/**
 * Per-project Zotero collection mapping. Reads/writes `projects.zotero_collection`.
 * The API key + library are per-user (user_settings); only the target collection
 * is per-project, so a project syncs to its own Zotero collection.
 */
export class ProjectZoteroStore implements IProjectBibliographyCollectionStore {
  constructor(private readonly db: SupabaseClient) {}

  async getCollection(projectId: string): Promise<string | undefined> {
    const { data, error } = await this.db
      .from("projects")
      .select("zotero_collection")
      .eq("id", projectId)
      .maybeSingle();
    if (error) throw error;
    return (data as { zotero_collection: string | null } | null)?.zotero_collection ?? undefined;
  }

  async setCollection(projectId: string, collection: string | null): Promise<void> {
    const { error } = await this.db
      .from("projects")
      .update({ zotero_collection: collection || null })
      .eq("id", projectId);
    if (error) throw error;
  }
}
