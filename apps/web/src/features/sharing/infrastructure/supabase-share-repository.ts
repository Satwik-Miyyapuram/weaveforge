import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ICurrentUserProvider,
  IShareRepository,
  NewShareInput,
  Share,
  ShareableType,
} from "@weaveforge/core";
import {
  type ShareRow,
  toDomain,
} from "./share-rows";
import { rows, run } from "@/backend/providers/supabase/row-access";

/**
 * Supabase adapter for shares (migration 0018). `owner_id` defaults to
 * auth.uid() server-side, so it's never sent. Grant is made idempotent by
 * delete-then-insert on (recipient, type, resource) — the delete only ever
 * touches the caller's own rows (RLS `shares_owner_all`), which sidesteps the
 * NULL-resource_id unique-index edge case an upsert would hit.
 */
const TABLE = "shares";

export class SupabaseShareRepository implements IShareRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly session: ICurrentUserProvider,
  ) {}

  async grant(input: NewShareInput): Promise<Share> {
    // Clear any existing grant for the same recipient+resource, then insert.
    let del = this.db
      .from(TABLE)
      .delete()
      .eq("recipient_id", input.recipientId)
      .eq("resource_type", input.resourceType);
    del =
      input.resourceId === null
        ? del.is("resource_id", null)
        : del.eq("resource_id", input.resourceId);
    const { error: delErr } = await del;
    if (delErr) throw delErr;

    const { data, error } = await this.db
      .from(TABLE)
      .insert({
        recipient_id: input.recipientId,
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        access: input.access ?? "comment",
      })
      .select("*")
      .single();
    if (error) throw error;
    return toDomain(data as ShareRow);
  }

  async revoke(id: string): Promise<void> {
    await run(this.db.from(TABLE).delete().eq("id", id));
  }

  async listForResource(
    resourceType: ShareableType,
    resourceId: string | null,
  ): Promise<Share[]> {
    let q = this.db.from(TABLE).select("*").eq("resource_type", resourceType);
    q = resourceId === null ? q.is("resource_id", null) : q.eq("resource_id", resourceId);
    return (await rows<ShareRow>(q)).map(toDomain);
  }

  async listSharedWithMe(resourceType?: ShareableType): Promise<Share[]> {
    const uid = await this.session.getCurrentUserId();
    if (!uid) return [];
    let q = this.db.from(TABLE).select("*").eq("recipient_id", uid);
    if (resourceType) q = q.eq("resource_type", resourceType);
    return (await rows<ShareRow>(q.order("created_at", { ascending: false }))).map(toDomain);
  }
}

