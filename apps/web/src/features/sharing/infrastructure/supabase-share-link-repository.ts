import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IShareLinkRepository,
  ResolvedShareLink,
  ShareLink,
  ShareLinkSaveInput,
} from "@weaveforge/core";
import type { ShareableType } from "@weaveforge/core";
import { decodeBytea, decodePostgresBase64, encodeBytea } from "@/lib/bytea.js";

function throwSupabaseError(error: { message?: string }, fallback: string): never {
  const msg = typeof error.message === "string" ? error.message : fallback;
  throw new Error(msg);
}

const TABLE = "share_links";

interface ShareLinkRow {
  id: string;
  owner_id: string;
  resource_type: ShareableType;
  resource_id: string;
  access: "view";
  token_hash: string;
  expires_at: string | null;
  created_at: string;
  dek_wrap: string | null;
  dek_epoch: number | null;
}

function mapRow(row: ShareLinkRow): ShareLink {
  return {
    id: row.id,
    ownerId: row.owner_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    access: row.access,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function mapResolved(row: {
  id: string;
  owner_id: string;
  resource_type: ShareableType;
  resource_id: string;
  access: "view";
  dek_wrap: string | null;
  dek_epoch: number | null;
}): ResolvedShareLink {
  return {
    id: row.id,
    ownerId: row.owner_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    access: row.access,
    dekWrap: row.dek_wrap ? decodeBytea(row.dek_wrap) : null,
    dekEpoch: row.dek_epoch,
  };
}

export class SupabaseShareLinkRepository implements IShareLinkRepository {
  constructor(private readonly db: SupabaseClient) {}

  async getById(id: string): Promise<ShareLink | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select("id, owner_id, resource_type, resource_id, access, token_hash, expires_at, created_at, dek_wrap, dek_epoch")
      .eq("id", id)
      .maybeSingle();
    if (error) throwSupabaseError(error, "Failed to load share link.");
    return data ? mapRow(data as ShareLinkRow) : null;
  }

  async listForResource(resourceType: ShareableType, resourceId: string): Promise<ShareLink[]> {
    const { data, error } = await this.db
      .from(TABLE)
      .select("id, owner_id, resource_type, resource_id, access, token_hash, expires_at, created_at, dek_wrap, dek_epoch")
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId)
      .order("created_at", { ascending: false });
    if (error) throwSupabaseError(error, "Failed to load share link.");
    return ((data ?? []) as ShareLinkRow[]).map(mapRow);
  }

  async save(input: ShareLinkSaveInput): Promise<ShareLink> {
    const { data, error } = await this.db
      .from(TABLE)
      .insert({
        id: input.id,
        owner_id: input.ownerId,
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        access: input.access,
        token_hash: encodeBytea(input.tokenHash),
        expires_at: input.expiresAt,
        dek_wrap: input.dekWrap ? encodeBytea(input.dekWrap) : null,
        dek_epoch: input.dekEpoch ?? null,
      })
      .select("*")
      .single();
    if (error) throwSupabaseError(error, "Failed to load share link.");
    return mapRow(data as ShareLinkRow);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.db.from(TABLE).delete().eq("id", id);
    if (error) throwSupabaseError(error, "Failed to load share link.");
  }

  async resolveByTokenHash(tokenHash: Uint8Array): Promise<ResolvedShareLink | null> {
    const { data, error } = await this.db.rpc("resolve_share_link", {
      p_token_hash: encodeBytea(tokenHash),
    });
    if (error) throwSupabaseError(error, "Failed to load share link.");
    const row = (data as Record<string, unknown>[] | null)?.[0];
    if (!row) return null;
    return mapResolved({
      id: row.id as string,
      owner_id: row.owner_id as string,
      resource_type: row.resource_type as ShareableType,
      resource_id: row.resource_id as string,
      access: row.access as "view",
      dek_wrap: (row.dek_wrap as string | null) ?? null,
      dek_epoch: (row.dek_epoch as number | null) ?? null,
    });
  }

  async redeem(tokenHash: Uint8Array): Promise<ResolvedShareLink | null> {
    const { data, error } = await this.db.rpc("redeem_share_link", {
      p_token_hash: encodeBytea(tokenHash),
    });
    if (error) throwSupabaseError(error, "Share link redeem failed.");
    if (!data) return null;
    const row = data as Record<string, unknown>;
    return {
      id: row.id as string,
      ownerId: row.ownerId as string,
      resourceType: row.resourceType as ShareableType,
      resourceId: row.resourceId as string,
      access: row.access as "view",
      dekWrap: row.dekWrap ? decodePostgresBase64(row.dekWrap as string) : null,
      dekEpoch: (row.dekEpoch as number | null) ?? null,
    };
  }
}
