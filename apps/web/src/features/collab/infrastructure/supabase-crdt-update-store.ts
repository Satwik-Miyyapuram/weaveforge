import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrdtUpdateRecord, ICrdtUpdateStore } from "@thesis/core";
import { decodeBytea, encodeBytea } from "@/lib/bytea.js";

const TABLE = "crdt_updates";

interface CrdtRow {
  id: number;
  resource_type: string;
  resource_id: string;
  project_id: string | null;
  epoch: number;
  payload: string;
  author_id: string;
  created_at: string;
}

function mapRow(row: CrdtRow): CrdtUpdateRecord {
  return {
    id: row.id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    projectId: row.project_id,
    epoch: row.epoch,
    payload: decodeBytea(row.payload),
    authorId: row.author_id,
    createdAt: row.created_at,
  };
}

export class SupabaseCrdtUpdateStore implements ICrdtUpdateStore {
  constructor(private readonly db: SupabaseClient) {}

  async append(input: {
    resourceType: string;
    resourceId: string;
    projectId: string | null;
    epoch: number;
    payload: Uint8Array;
    authorId: string;
  }): Promise<CrdtUpdateRecord> {
    const { data, error } = await this.db
      .from(TABLE)
      .insert({
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        project_id: input.projectId,
        epoch: input.epoch,
        payload: encodeBytea(input.payload),
        author_id: input.authorId,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapRow(data as CrdtRow);
  }

  async listAfter(
    resourceType: string,
    resourceId: string,
    afterId = 0,
  ): Promise<CrdtUpdateRecord[]> {
    const { data, error } = await this.db
      .from(TABLE)
      .select("*")
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId)
      .gt("id", afterId)
      .order("id", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as CrdtRow[]).map(mapRow);
  }

  async deleteUpTo(resourceType: string, resourceId: string, uptoId: number): Promise<void> {
    const { error } = await this.db
      .from(TABLE)
      .delete()
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId)
      .lte("id", uptoId);
    if (error) throw error;
  }

  async deleteAll(resourceType: string, resourceId: string): Promise<void> {
    const { error } = await this.db
      .from(TABLE)
      .delete()
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId);
    if (error) throw error;
  }

  async countAfter(
    resourceType: string,
    resourceId: string,
    afterId = 0,
  ): Promise<number> {
    const { count, error } = await this.db
      .from(TABLE)
      .select("*", { count: "exact", head: true })
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId)
      .gt("id", afterId);
    if (error) throw error;
    return count ?? 0;
  }
}
