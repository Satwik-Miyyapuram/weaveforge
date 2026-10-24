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
import { one, oneRow, rows, run } from "@/backend/providers/postgrest/row-access";

/**
 * PostgREST adapter for shares (migration 0018). `owner_id` defaults to
 * auth.uid() server-side, so it's never sent.
 *
 * Grant changes an existing share in place and inserts only when there is none.
 * It used to delete and re-insert, which left the recipient with no access when
 * the insert failed. An upsert is not possible: the unique index is on an
 * expression (`coalesce(resource_id, ...)`) PostgREST cannot target. The update
 * only ever touches the caller's own rows (RLS `shares_owner_all`).
 */
/**
 * The columns a ShareRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
const SHARE_COLUMNS = "id,owner_id,recipient_id,resource_type,resource_id,access,created_at";

const TABLE = "shares";

/** Postgres: a row with the same unique key already exists. */
const UNIQUE_VIOLATION = "23505";

export class PostgrestShareRepository implements IShareRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly session: ICurrentUserProvider,
  ) {}

  async grant(input: NewShareInput): Promise<Share> {
    const access = input.access ?? "comment";
    const changed = await this.changeAccess(input, access);
    if (changed) return toDomain(changed);

    try {
      return toDomain(await oneRow<ShareRow>(this.db
        .from(TABLE)
        .insert({
          recipient_id: input.recipientId,
          resource_type: input.resourceType,
          resource_id: input.resourceId,
          access,
        })
        .select(SHARE_COLUMNS)
        .single()));
    } catch (e) {
      // Another grant for the same recipient inserted first; change that one.
      if ((e as { code?: unknown } | null)?.code !== UNIQUE_VIOLATION) throw e;
      const row = await this.changeAccess(input, access);
      if (!row) throw e;
      return toDomain(row);
    }
  }

  /** Set the access on the caller's existing share, if there is one. */
  private async changeAccess(input: NewShareInput, access: string): Promise<ShareRow | null> {
    let q = this.db
      .from(TABLE)
      .update({ access })
      .eq("recipient_id", input.recipientId)
      .eq("resource_type", input.resourceType);
    q = input.resourceId === null ? q.is("resource_id", null) : q.eq("resource_id", input.resourceId);
    return one<ShareRow>(q.select(SHARE_COLUMNS).maybeSingle());
  }

  async revoke(id: string): Promise<void> {
    await run(this.db.from(TABLE).delete().eq("id", id));
  }

  async listForResource(
    resourceType: ShareableType,
    resourceId: string | null,
  ): Promise<Share[]> {
    let q = this.db.from(TABLE).select(SHARE_COLUMNS).eq("resource_type", resourceType);
    q = resourceId === null ? q.is("resource_id", null) : q.eq("resource_id", resourceId);
    return (await rows<ShareRow>(q)).map(toDomain);
  }

  async listSharedWithMe(resourceType?: ShareableType): Promise<Share[]> {
    const uid = await this.session.getCurrentUserId();
    if (!uid) return [];
    let q = this.db.from(TABLE).select(SHARE_COLUMNS).eq("recipient_id", uid);
    if (resourceType) q = q.eq("resource_type", resourceType);
    return (await rows<ShareRow>(q.order("created_at", { ascending: false }))).map(toDomain);
  }
}

